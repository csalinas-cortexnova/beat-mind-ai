import { db } from "@/lib/db";
import {
  sessions,
  sessionAthletes,
  athletes,
  gyms,
  hrReadings,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { validateReportToken } from "@/lib/reports/token";
import { downsampleHrData } from "@/lib/utils/downsample";
import { ZONES } from "@/lib/hr/zones";
import ReportView from "./ReportView";

// Next.js 16: params and searchParams are Promises
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string; athleteId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { sessionId, athleteId } = await params;
  const { token } = await searchParams;

  // Validate token
  if (!token) {
    return (
      <ErrorState message="Token de acceso no proporcionado." />
    );
  }

  const tokenData = validateReportToken(token);
  if (!tokenData) {
    return (
      <ErrorState message="Este reporte ya no esta disponible. Contacta a tu gimnasio para un nuevo enlace." />
    );
  }

  // Verify token matches URL params
  if (tokenData.sessionId !== sessionId || tokenData.athleteId !== athleteId) {
    return (
      <ErrorState message="Token no valido para este reporte." />
    );
  }

  // Fetch all data (session, gym, athlete stats, HR readings)
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: {
      id: true,
      classType: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      athleteCount: true,
      aiSummary: true,
    },
  });

  if (!session) {
    return <ErrorState message="Sesion no encontrada." />;
  }

  const gym = await db.query.gyms.findFirst({
    where: eq(gyms.id, tokenData.gymId),
    columns: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });

  const athleteStats = await db.query.sessionAthletes.findFirst({
    where: and(
      eq(sessionAthletes.sessionId, sessionId),
      eq(sessionAthletes.athleteId, athleteId)
    ),
  });

  const athleteInfo = await db.query.athletes.findFirst({
    where: eq(athletes.id, athleteId),
    columns: { id: true, name: true },
  });

  // Fetch HR readings for timeline chart (downsampled to 500)
  const rawReadings = await db
    .select({
      heartRateBpm: hrReadings.heartRateBpm,
      recordedAt: hrReadings.recordedAt,
    })
    .from(hrReadings)
    .where(
      and(
        eq(hrReadings.sessionId, sessionId),
        eq(hrReadings.athleteId, athleteId)
      )
    )
    .orderBy(asc(hrReadings.recordedAt));

  const hrData = downsampleHrData(
    rawReadings.map((r) => ({
      recordedAt: r.recordedAt.toISOString(),
      heartRateBpm: r.heartRateBpm,
    })),
    500
  );

  // Build zone data for bar chart
  const zoneData = [
    {
      zone: 1,
      name: ZONES[0].names.es,
      color: ZONES[0].color,
      seconds: athleteStats?.timeZone1S ?? 0,
    },
    {
      zone: 2,
      name: ZONES[1].names.es,
      color: ZONES[1].color,
      seconds: athleteStats?.timeZone2S ?? 0,
    },
    {
      zone: 3,
      name: ZONES[2].names.es,
      color: ZONES[2].color,
      seconds: athleteStats?.timeZone3S ?? 0,
    },
    {
      zone: 4,
      name: ZONES[3].names.es,
      color: ZONES[3].color,
      seconds: athleteStats?.timeZone4S ?? 0,
    },
    {
      zone: 5,
      name: ZONES[4].names.es,
      color: ZONES[4].color,
      seconds: athleteStats?.timeZone5S ?? 0,
    },
  ];

  // Format duration
  const durationSeconds = session.durationSeconds ?? 0;
  const mins = Math.floor(durationSeconds / 60);
  const secs = durationSeconds % 60;
  const durationFormatted = `${mins}:${String(secs).padStart(2, "0")}`;

  return (
    <ReportView
      gym={{
        name: gym?.name ?? "",
        logoUrl: gym?.logoUrl,
        primaryColor: gym?.primaryColor,
        secondaryColor: gym?.secondaryColor,
      }}
      session={{
        classType: session.classType,
        startedAt: session.startedAt.toISOString(),
        duration: durationFormatted,
        aiSummary: session.aiSummary,
      }}
      athlete={{
        name: athleteInfo?.name ?? "Atleta",
        avgHr: athleteStats?.avgHr ?? 0,
        maxHr: athleteStats?.maxHr ?? 0,
        minHr: athleteStats?.minHr ?? 0,
        calories: athleteStats?.calories ?? 0,
      }}
      zoneData={zoneData}
      hrData={hrData}
    />
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md text-center">
        <div className="text-6xl mb-4" aria-hidden="true">
          &#x1F4CA;
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Reporte no disponible
        </h1>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
}

"use client";

import { ZoneDistributionChart } from "@/components/reports/ZoneDistributionChart";
import { HrTimelineChart } from "@/components/reports/HrTimelineChart";

interface ReportViewProps {
  gym: {
    name: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  };
  session: {
    classType?: string | null;
    startedAt: string;
    duration: string;
    aiSummary?: string | null;
  };
  athlete: {
    name: string;
    avgHr: number;
    maxHr: number;
    minHr: number;
    calories: number;
  };
  zoneData: Array<{
    zone: number;
    name: string;
    color: string;
    seconds: number;
  }>;
  hrData: Array<{ recordedAt: string; heartRateBpm: number }>;
}

export default function ReportView({
  gym,
  session,
  athlete,
  zoneData,
  hrData,
}: ReportViewProps) {
  const primaryColor = gym.primaryColor || "#6366F1";
  const secondaryColor = gym.secondaryColor || "#1E1B4B";
  const date = new Date(session.startedAt).toLocaleDateString("es", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      {/* Gym Header */}
      <header
        className="px-4 py-6 text-center"
        style={{ backgroundColor: secondaryColor, color: "#fff" }}
      >
        {gym.logoUrl && (
          <img
            src={gym.logoUrl}
            alt={gym.name}
            className="h-12 mx-auto mb-2"
          />
        )}
        <h1 className="text-lg font-bold">{gym.name}</h1>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Session Info */}
        <div className="text-center">
          <p className="text-sm text-gray-500">{date}</p>
          <p
            className="text-xl font-bold"
            style={{ color: primaryColor }}
          >
            {session.classType || "Sesion"}
          </p>
          <p className="text-sm text-gray-600">
            Duracion: {session.duration}
          </p>
        </div>

        {/* Athlete Name */}
        <h2 className="text-lg font-semibold text-center text-gray-900">
          {athlete.name}
        </h2>

        {/* HR Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Promedio"
            value={`${athlete.avgHr}`}
            unit="BPM"
            color={primaryColor}
          />
          <StatCard
            label="Maximo"
            value={`${athlete.maxHr}`}
            unit="BPM"
            color="#EF4444"
          />
          <StatCard
            label="Minimo"
            value={`${athlete.minHr}`}
            unit="BPM"
            color="#3B82F6"
          />
        </div>

        {/* Calories */}
        {athlete.calories > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm text-center">
            <p
              className="text-3xl font-bold tabular-nums"
              style={{ color: primaryColor }}
            >
              {athlete.calories}
            </p>
            <p className="text-sm text-gray-500">Calorias estimadas</p>
          </div>
        )}

        {/* Zone Distribution */}
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Distribucion por Zonas
          </h3>
          <ZoneDistributionChart data={zoneData} />
        </div>

        {/* HR Timeline */}
        {hrData.length > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Frecuencia Cardiaca
            </h3>
            <HrTimelineChart data={hrData} startedAt={session.startedAt} />
          </div>
        )}

        {/* AI Summary */}
        {session.aiSummary && (
          <div
            className="bg-white rounded-lg p-4 shadow-sm border-l-4"
            style={{ borderColor: primaryColor }}
          >
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Resumen AI
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              {session.aiSummary}
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-gray-400 pt-4 pb-8 print:pb-2">
          <p>Generado por BeatMind AI para {gym.name}</p>
        </footer>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg p-3 shadow-sm text-center">
      <p
        className="text-2xl font-bold tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500">{unit}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

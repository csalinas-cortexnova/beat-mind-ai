/** Matches GET /api/v1/superadmin/gyms response item */
export interface GymListItem {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  maxAthletes: number;
  timezone: string;
  language: string;
  createdAt: string;
  stats: {
    activeAthletes: number;
    totalSessions: number;
    agentsOnline: number;
    agentsTotal: number;
    lastSession: string | null;
  };
}

/** Detailed gym (same as list item + extra fields for detail view) */
export interface GymDetail extends GymListItem {
  clerkOrgId: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  tvAccessToken: string | null;
}

/** Form data for creating a gym */
export interface GymFormData {
  name: string;
  slug: string;
  address: string | null;
  ownerEmail: string;
  plan: "starter" | "pro" | "enterprise";
  maxAthletes: number;
}

/** Form data for updating a gym */
export interface GymUpdateData {
  name?: string;
  address?: string | null;
  subscriptionStatus?: "active" | "suspended" | "cancelled" | "trial";
  subscriptionPlan?: "starter" | "pro" | "enterprise";
  maxAthletes?: number;
  timezone?: string;
  language?: "es" | "pt" | "en";
}

/** Matches GET /api/v1/superadmin/agents response item */
export interface AgentListItem {
  id: string;
  gymId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  hardwareModel: string | null;
  serialNumber: string | null;
  lastHeartbeat: string | null;
  ipAddress: string | null;
  softwareVersion: string | null;
  createdAt: string;
  gymName: string | null;
}

/** Overview page stats */
export interface OverviewStats {
  totalGyms: number;
  activeGyms: number;
  totalAthletes: number;
  activeSessions: number;
  totalAgents: number;
  agentsOnline: number;
}

/** Generic paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

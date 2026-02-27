export interface ClerkEmailAddress {
  email_address: string;
  id: string;
}

export interface ClerkUserEventData {
  id: string;
  email_addresses: ClerkEmailAddress[];
  first_name: string | null;
  last_name: string | null;
  public_metadata: {
    is_superadmin?: boolean;
  };
}

export interface ClerkUserDeletedEventData {
  id: string;
  deleted: boolean;
}

export interface ClerkOrganizationEventData {
  id: string;
  name: string;
  slug: string;
}

export interface ClerkOrgMembershipEventData {
  id: string;
  organization: {
    id: string;
  };
  public_user_data: {
    user_id: string;
  };
  role: string;
}

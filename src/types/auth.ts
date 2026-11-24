export interface AccountUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AccountUsage {
  date: string;
  analysesUsed: number;
  analysisLimit: number;
  aiActionsUsed: number;
  aiActionLimit: number;
  resetsAt: string;
}

export interface AuthSessionResponse {
  user: AccountUser | null;
  usage: AccountUsage | null;
  error?: string;
  code?: string;
}

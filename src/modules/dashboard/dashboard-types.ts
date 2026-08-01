export interface DashboardSummary {
  totalNotes: number;
  activeSharedNotes: number;
  totalTags: number;
  totalTerms: number;
  totalFavorites: number;
  totalProjects: number;
  trashNotes: number;
  totalPromptCharacters: number;
}

export interface DashboardTagStatistic {
  id: string;
  name: string;
  noteCount: number;
}

export interface DashboardSnapshot {
  summary: DashboardSummary;
  tags: DashboardTagStatistic[];
}

/** A backup just made (`backup_project`). */
export interface BackupCreated {
  path: string;
  fileName: string;
  /** Problems that did not stop the backup: damaged chapters copied as-is, images left out. */
  warnings: string[];
}

/** A backup in this device's backups folder (`list_backups`). */
export interface BackupInfo {
  path: string;
  fileName: string;
  projectId: string;
  projectName: string;
  size: number;
  createdAt: string;
}

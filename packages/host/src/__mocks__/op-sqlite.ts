// Mock for @op-engineering/op-sqlite — provides the DB type interface
// Tests create their own mock DB instances; this just satisfies the import.

export interface DB {
  execute(sql: string, params?: unknown[]): { rows: Record<string, unknown>[]; rowsAffected: number; insertId?: number };
  transaction(cb: (tx: { execute(sql: string, params?: unknown[]): void }) => void): void;
}

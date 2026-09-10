export interface SqlResult { meta: { changes?: number } }
export interface SqlStatement {
  bind(...values: (string | number | null)[]): SqlStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<SqlResult>;
}
export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<SqlResult[]>;
}

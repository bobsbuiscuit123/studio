type BalanceSource = {
  balance: number;
  source: 'token' | 'credit' | 'none';
};

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
const MISSING_FUNCTION_CODES = new Set(['42883', 'PGRST202']);

const normalizeErrorText = (error: unknown) =>
  JSON.stringify(error ?? '').toLowerCase();

export const isMissingColumnError = (error: unknown, column: string) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : '';
  return (
    MISSING_COLUMN_CODES.has(code) ||
    normalizeErrorText(error).includes(`column ${column.toLowerCase()}`) ||
    normalizeErrorText(error).includes(column.toLowerCase())
  );
};

export const isMissingFunctionError = (error: unknown, fnName: string) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : '';
  return (
    MISSING_FUNCTION_CODES.has(code) ||
    normalizeErrorText(error).includes(fnName.toLowerCase())
  );
};

export const readBalance = (row?: { token_balance?: unknown; credit_balance?: unknown } | null): BalanceSource => {
  if (row && row.token_balance != null) {
    return { balance: Number(row.token_balance ?? 0), source: 'token' };
  }
  if (row && row.credit_balance != null) {
    return { balance: Number(row.credit_balance ?? 0), source: 'credit' };
  }
  return { balance: 0, source: 'none' };
};

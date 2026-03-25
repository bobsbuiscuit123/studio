type BalanceSource = {
  balance: number;
  source: 'token' | 'credit' | 'none';
  tokenBalance: number | null;
  creditBalance: number | null;
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

const normalizeBalance = (value: unknown) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const readBalance = (row?: { token_balance?: unknown; credit_balance?: unknown } | null): BalanceSource => {
  const tokenBalance = normalizeBalance(row?.token_balance);
  const creditBalance = normalizeBalance(row?.credit_balance);

  if (tokenBalance != null && tokenBalance > 0) {
    return { balance: tokenBalance, source: 'token', tokenBalance, creditBalance };
  }

  if ((tokenBalance == null || tokenBalance <= 0) && creditBalance != null && creditBalance > 0) {
    return { balance: creditBalance, source: 'credit', tokenBalance, creditBalance };
  }

  if (tokenBalance != null) {
    return { balance: tokenBalance, source: 'token', tokenBalance, creditBalance };
  }

  if (creditBalance != null) {
    return { balance: creditBalance, source: 'credit', tokenBalance, creditBalance };
  }

  return { balance: 0, source: 'none', tokenBalance, creditBalance };
};

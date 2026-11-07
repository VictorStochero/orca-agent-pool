/** Percentual de uso válido (número finito de 0 a 100, sem arredondar); qualquer outra coisa vira null. */
export const percentual = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null)

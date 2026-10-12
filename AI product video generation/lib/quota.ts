export const currentPeriod = (now = new Date()) => now.toISOString().slice(0, 7);
export const canGenerate = (used: number, quota: number) => used < quota;

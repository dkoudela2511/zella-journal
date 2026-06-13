// Serverové výpočty – musí odpovídat logice v components/Journal.jsx
function num(v) { return parseFloat(v); }

export function computePnl(t) {
  const e = num(t.entryPrice), x = num(t.exitPrice), s = num(t.quantity);
  if (isFinite(e) && isFinite(x) && isFinite(s)) {
    const g = t.direction === "short" ? (e - x) * s : (x - e) * s;
    const fees = num(t.fees);
    return g - (isFinite(fees) ? fees : 0);
  }
  const m = num(t.pnl);
  return isFinite(m) ? m : 0;
}

export function summarize(trades) {
  const real = (Array.isArray(trades) ? trades : []).filter((t) => !t.missed);
  const pnls = real.map(computePnl);
  const net = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const n = real.length;
  const grossWin = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  return {
    tradeCount: n,
    netPnl: net,
    winRate: n ? (wins / n) * 100 : 0,
    wins, losses,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
  };
}

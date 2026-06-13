// Serverové výpočty – musí odpovídat logice v components/Journal.jsx
function num(v) { return parseFloat(v); }

// instMap: { SYMBOL(UPPER): { tickSize, tickValue } }
export function computePnl(t, instMap = {}) {
  const inst = instMap[String(t.symbol || "").trim().toUpperCase()];
  const e = num(t.entryPrice), x = num(t.exitPrice), q = num(t.quantity);
  const fees = isFinite(num(t.fees)) ? num(t.fees) : 0;
  if (inst && isFinite(e) && isFinite(x) && isFinite(q) && inst.tickSize > 0) {
    const move = t.direction === "short" ? (e - x) : (x - e);
    const ticks = move / inst.tickSize;
    return ticks * inst.tickValue * q - fees;
  }
  if (isFinite(e) && isFinite(x) && isFinite(q)) {
    const g = t.direction === "short" ? (e - x) * q : (x - e) * q;
    return g - fees;
  }
  const m = num(t.pnl);
  return isFinite(m) ? m : 0;
}

export function summarize(trades, instMap = {}) {
  const real = (Array.isArray(trades) ? trades : []).filter((t) => !t.missed);
  const pnls = real.map((t) => computePnl(t, instMap));
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

export function instrumentMap(instruments) {
  const m = {};
  (instruments || []).forEach((i) => { if (i && i.symbol) m[String(i.symbol).toUpperCase()] = i; });
  return m;
}

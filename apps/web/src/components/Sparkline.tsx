interface Props {
  points: { price: number | null; at: string }[];
  height?: number;
}

/**
 * Linha do preço desenhada direto na etiqueta. Marca o menor valor da série
 * com um ponto, porque é essa a informação que decide se a oferta vale.
 */
export function Sparkline({ points, height = 34 }: Props) {
  const values = points.map((p) => p.price ?? 0).filter((v) => v > 0);
  if (values.length < 2) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Sem histórico ainda.</div>;
  }

  const w = 260;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = w / (values.length - 1);

  const coords = values.map((v, i) => [i * stepX, height - 4 - ((v - min) / span) * (height - 10)] as const);
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const minIndex = values.indexOf(min);
  const last = coords[coords.length - 1];

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={`Preço variou de ${min.toFixed(2)} a ${max.toFixed(2)} reais`}>
      <path d={`${path} L${w},${height} L0,${height} Z`} fill="rgba(22,23,26,0.05)" stroke="none" />
      <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={coords[minIndex][0]} cy={coords[minIndex][1]} r="2.5" fill="var(--gain)" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--drop)" />
    </svg>
  );
}

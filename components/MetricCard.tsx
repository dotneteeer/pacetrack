'use client';

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  color?: string; // tailwind text color class, e.g. "text-[#FC4C02]"
  large?: boolean; // primary metric — larger font
  subtext?: string; // e.g. "ahead of schedule"
}

export default function MetricCard({ label, value, unit, color, large, subtext }: MetricCardProps) {
  return (
    <div className={`bg-[#111111] rounded-xl ${large ? 'p-5' : 'p-4'}`}>
      <div className="text-xs text-gray-400 uppercase tracking-widest mb-1">{label}</div>
      <div className={`font-black tabular-nums ${large ? 'text-4xl md:text-6xl' : 'text-2xl'} ${color ?? ''}`}>
        {value}
        {unit && (
          <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
        )}
      </div>
      {subtext && (
        <div className="text-xs text-gray-500 mt-1">{subtext}</div>
      )}
    </div>
  );
}

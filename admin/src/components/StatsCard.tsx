export const StatsCard = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <div className="rounded-card border border-black-300 bg-white p-6">
    <p className="text-3xl font-semibold text-black-900">{value}</p>
    <p className="mt-1 text-sm text-black-600">{label}</p>
  </div>
);

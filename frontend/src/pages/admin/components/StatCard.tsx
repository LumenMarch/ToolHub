import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface StatCardProps {
  label: string
  value: number | string
  hint?: string
}

const StatCard: React.FC<StatCardProps> = ({ label, value, hint }) => {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        {hint ? (
          <CardDescription>{hint}</CardDescription>
        ) : null}
      </CardHeader>
    </Card>
  )
}

export default StatCard

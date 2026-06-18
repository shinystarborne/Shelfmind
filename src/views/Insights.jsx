import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, CartesianGrid,
} from 'recharts'
import { API } from '../App'

const PALETTE = ['#e8b4b8', '#c97b84', '#a8b89a', '#7a9168', '#c4a0a8', '#e8b96a', '#9ab8c4', '#ddc4a0']
const ROSE = '#c97b84'
const SAGE = '#7a9168'
const AMBER = '#e8b96a'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      boxShadow: 'var(--shadow-card)',
    }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--text-soft)' }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  )
}

function StatCard({ value, label, sub, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={accent ? { color: accent } : {}}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function Insights() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/insights`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="empty-state" style={{ flex: 1 }}>
      <div className="spin" style={{ fontSize: 32 }}>↻</div>
      <p>Crunching your library…</p>
    </div>
  )

  if (!data) return (
    <div className="empty-state" style={{ flex: 1 }}>
      <div className="empty-icon">📊</div>
      <p>No data yet. Scan your library first.</p>
    </div>
  )

  const readCount   = data.byStatus.find(s => s.status === 'read')?.count    ?? 0
  const readingCount = data.byStatus.find(s => s.status === 'reading')?.count ?? 0
  const readPct     = data.total > 0 ? Math.round((readCount / data.total) * 100) : 0

  const statusChartData = [
    { name: 'Unread',  value: data.byStatus.find(s => s.status === 'unread')?.count ?? 0,  color: '#e0cfc4' },
    { name: 'Reading', value: readingCount, color: AMBER },
    { name: 'Read',    value: readCount,    color: SAGE  },
  ]

  const langData = data.byLanguage.map((l, i) => ({ ...l, color: PALETTE[i % PALETTE.length] }))
  const fmtData  = data.byFormat.map((f, i)  => ({ ...f, color: PALETTE[i % PALETTE.length] }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="topbar">
        <div className="topbar-title">Insights</div>
      </div>

      <div className="insights-body">
        {/* Stat cards */}
        <div className="stat-cards">
          <StatCard value={data.total} label="Total Books" accent={ROSE} />
          <StatCard value={`${readPct}%`} label="Read" sub={`${readCount} of ${data.total} books`} accent={SAGE} />
          <StatCard value={readingCount} label="Currently Reading" accent={AMBER} />
          <StatCard value={data.byAuthor.length} label="Authors" />
          <StatCard
            value={data.byLanguage.length}
            label="Languages"
            sub={data.byLanguage.map(l => l.lang).join(', ')}
          />
          <StatCard
            value={data.bySeries.length}
            label="Series"
            sub="with 2+ books"
          />
        </div>

        <div className="charts-grid">
          {/* Read status donut */}
          <div className="chart-card">
            <h3>Reading Progress</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ''}
                  labelLine={false}
                >
                  {statusChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Language split */}
          <div className="chart-card">
            <h3>Languages</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={langData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="lang"
                  label={({ lang, percent }) => percent > 0.05 ? `${lang} ${(percent * 100).toFixed(0)}%` : ''}
                  labelLine={false}
                >
                  {langData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Top authors */}
          <div className="chart-card chart-card-wide">
            <h3>Top Authors</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={data.byAuthor.slice(0, 15)}
                layout="vertical"
                margin={{ left: 16, right: 24, top: 0, bottom: 0 }}
              >
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis
                  type="category"
                  dataKey="author"
                  width={130}
                  tick={{ fontSize: 11, fill: 'var(--text-soft)' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Books" radius={[0, 4, 4, 0]}>
                  {data.byAuthor.slice(0, 15).map((_, i) => (
                    <Cell key={i} fill={i % 2 === 0 ? ROSE : '#dda8ae'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Format breakdown */}
          <div className="chart-card">
            <h3>Formats</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={fmtData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="format"
                  label={({ format, percent }) => percent > 0.05 ? `${format?.toUpperCase()} ${(percent * 100).toFixed(0)}%` : ''}
                  labelLine={false}
                >
                  {fmtData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Added over time */}
          {data.addedOverTime.length > 1 && (
            <div className="chart-card">
              <h3>Books Added Over Time</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.addedOverTime} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={ROSE} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={ROSE} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={28} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Books"
                    stroke={ROSE}
                    fill="url(#areaGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Series completeness */}
          {data.bySeries.length > 0 && (
            <div className="chart-card chart-card-wide">
              <h3>Series Progress</h3>
              <div className="series-list">
                {data.bySeries.map(s => {
                  const pct = Math.round((s.read_count / s.total) * 100)
                  return (
                    <div key={s.series_name} className="series-row">
                      <div className="series-row-label">
                        <span className="sname">{s.series_name}</span>
                        <span className="scount">{s.read_count}/{s.total} read</span>
                      </div>
                      <div className="series-bar-bg">
                        <div className="series-bar-fill read" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

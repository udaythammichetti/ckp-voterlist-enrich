import { Link } from 'react-router-dom'
import MixBars from './MixBars'
import { campaignTone } from '../lib/campaignStatus'

/** Compact campaign summary — one KPI row + one chart. */
export default function CampaignStatusPanel({
  campaign,
  dataSource = '',
  compact = false,
  title = 'Campaign',
}) {
  if (!campaign?.total) return null

  const tone = campaignTone(campaign)
  const chart = campaign.groupBars?.length ? campaign.groupBars : campaign.bars

  return (
    <article className={`panel campaign-panel tone-${tone}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        <Link to="/campaign">Board</Link>
      </div>
      {!compact && dataSource ? (
        <p className="muted small campaign-source">{dataSource}</p>
      ) : null}

      <div className="campaign-kpi-row">
        <div>
          <span>Support+</span>
          <strong>{campaign.positive.toLocaleString()}</strong>
        </div>
        <div>
          <span>Not support</span>
          <strong>{(campaign.negative || 0).toLocaleString()}</strong>
        </div>
        <div>
          <span>Field</span>
          <strong>{(campaign.field || 0).toLocaleString()}</strong>
        </div>
        <div>
          <span>Not set</span>
          <strong>{campaign.unset.toLocaleString()}</strong>
        </div>
      </div>

      {chart?.length ? (
        <MixBars items={chart} accent="amber" />
      ) : (
        <p className="muted small">Set voter status to see the mix.</p>
      )}
    </article>
  )
}

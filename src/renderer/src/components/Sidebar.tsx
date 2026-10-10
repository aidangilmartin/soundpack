import { BankCategory, CATEGORY_LABELS } from '@core/catalog'
import type { BankItem } from '../model'

interface Props {
  items: BankItem[]
  activeKey: string | null
  onSelect: (item: BankItem) => void
  onExtractFromGame: () => void
  onImportAwc: () => void
  onImportCodeWalker: () => void
}

const ORDER: BankCategory[] = ['shared', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'mg', 'heavy', 'other']

export function Sidebar({ items, activeKey, onSelect, onExtractFromGame, onImportAwc, onImportCodeWalker }: Props) {
  const imported = items.filter((i) => i.template).length
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="btn primary" onClick={onExtractFromGame} title="Read the original banks from your GTA V install with CodeWalker">
          Extract from GTA V…
        </button>
        <div className="row gap import-row">
          <button className="btn subtle small" onClick={onImportAwc} title="Import .awc files you exported yourself">
            Import .awc…
          </button>
          <button
            className="btn subtle small"
            onClick={onImportCodeWalker}
            title="Import CodeWalker 'Export XML' output (.awc.xml + wav folder)"
          >
            Import XML…
          </button>
        </div>
        <p className="muted small">
          {imported} bank{imported === 1 ? '' : 's'} in your library.
        </p>
      </div>
      <nav className="bank-list" aria-label="Sound banks">
        {ORDER.map((cat) => {
          const group = items.filter((i) => i.category === cat)
          if (group.length === 0) return null
          return (
            <section key={cat}>
              <h3>{CATEGORY_LABELS[cat]}</h3>
              <ul>
                {group.map((item) => (
                  <li key={item.key}>
                    <button
                      className={`bank-item${item.key === activeKey ? ' active' : ''}${item.template ? '' : ' missing'}`}
                      onClick={() => onSelect(item)}
                      title={`${item.pack}/${item.file}`}
                    >
                      <span className="bank-label">
                        {item.label}
                        {item.certainty === 'guess' && item.category !== 'other' && <span className="guess">?</span>}
                      </span>
                      <span className="bank-meta">
                        {item.changed > 0 && <span className="badge accent">{item.changed} changed</span>}
                        {item.template ? (
                          <span className="muted">{item.template.streamCount}</span>
                        ) : (
                          <span className="muted">not imported</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </nav>
    </aside>
  )
}

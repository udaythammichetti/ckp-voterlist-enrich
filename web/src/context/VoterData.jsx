import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildDatasetPayload,
  clearLatestDataset,
  saveLatestDataset,
} from '../lib/dataStore'
import {
  checkEnrichmentApi,
  fetchEnrichmentMap,
  importEnrichmentMap,
  isEnrichmentApiAvailable,
  putEnrichment,
  subscribeEnrichmentEvents,
} from '../lib/apiEnrichment'
import {
  computeAgeBand,
  loadEnrichmentMap,
  mergeEnrichmentRow,
  replaceEnrichmentMap,
  setEnrichment,
} from '../lib/enrichment'
import {
  downloadEnrichmentPatch,
  downloadVotersVersion,
  getVersionBackups,
  persistWorkingCopy,
  restoreBrowserBackup,
  serializeVoter,
} from '../lib/exportVersion'
import { buildCampaignStatus } from '../lib/campaignStatus'
import { buildFamilies, familyStats, filterFamilies } from '../lib/families'
import {
  computeStats,
  filterVoters,
  loadBestVoters,
  loadVotersFromJson,
  loadVotersFromObject,
} from '../lib/loadVoters'

const VoterDataContext = createContext(null)

function applyRowToVoter(v, saved) {
  const next = { ...v }
  if (saved.name) next.name = saved.name
  if (saved.relationType) next.relationType = saved.relationType
  if (saved.relationName) next.relationName = saved.relationName
  if (saved.house) next.house = saved.house
  if (saved.gender) next.gender = saved.gender
  if (saved.age != null) {
    next.age = saved.age
    next.ageBand = computeAgeBand(saved.age)
  }
  next.phone = saved.phone
  next.currentAddress = saved.currentAddress
  next.notes = saved.notes
  next.voterStatus = saved.voterStatus
  next._overridden = true
  next.enriched = Boolean(
    next.phone || next.currentAddress || next.notes || next.voterStatus || next._overridden,
  )
  return next
}

export function VoterDataProvider({ children }) {
  const [voters, setVoters] = useState([])
  const [meta, setMeta] = useState({})
  const [dataSource, setDataSource] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dbLive, setDbLive] = useState(false)
  const [q, setQ] = useState('')
  const [part, setPart] = useState('')
  const [sectionNo, setSectionNo] = useState('')
  const [gender, setGender] = useState('')
  const [ageBand, setAgeBand] = useState('')
  const [pcs, setPcs] = useState([])
  const [pollingStations, setPollingStations] = useState([])
  const [familyQ, setFamilyQ] = useState('')
  const [familyMinSize, setFamilyMinSize] = useState(0)
  const [familyOnlyUnlinked, setFamilyOnlyUnlinked] = useState(false)
  const [enrichedOnly, setEnrichedOnly] = useState(false)
  const [voterStatus, setVoterStatus] = useState('')
  const [selectedVoter, setSelectedVoter] = useState(null)
  const persistTimer = useRef(null)
  const votersRef = useRef(voters)
  const metaRef = useRef(meta)
  votersRef.current = voters
  metaRef.current = meta

  const applyLoaded = useCallback((rows, m, sourceLabel) => {
    setVoters(rows)
    setMeta(m || {})
    setDataSource(sourceLabel || m?.loadedFrom || 'voters.json')
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setError('')

        const health = await checkEnrichmentApi()
        if (!alive) return
        if (health.db) {
          try {
            let remote = await fetchEnrichmentMap()
            const local = loadEnrichmentMap()
            const localCount = Object.keys(local).length
            const remoteCount = Object.keys(remote).length
            // First deploy: push browser enrichment into Postgres once.
            if (remoteCount === 0 && localCount > 0) {
              await importEnrichmentMap(local)
              remote = await fetchEnrichmentMap()
            }
            replaceEnrichmentMap(remote)
            setDbLive(true)
          } catch (e) {
            console.warn('enrichment sync failed, using local cache', e)
            setDbLive(false)
          }
        } else {
          setDbLive(false)
        }

        const { voters: rows, meta: m, sourceLabel } = await loadBestVoters()
        if (!alive) return
        applyLoaded(rows, m, sourceLabel)
      } catch (e) {
        if (!alive) return
        console.error(e)
        setError(e.message || 'Failed to load voter data')
        setVoters([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [applyLoaded])

  useEffect(() => {
    if (!dbLive) return undefined
    return subscribeEnrichmentEvents({
      onEnrichment: ({ epic, row }) => {
        if (!epic || !row) return
        const key = String(epic).toUpperCase()
        mergeEnrichmentRow(key, row)
        setVoters((prev) => prev.map((v) => (v.epic === key ? applyRowToVoter(v, row) : v)))
        setSelectedVoter((cur) => (cur && cur.epic === key ? applyRowToVoter(cur, row) : cur))
      },
      onReload: async () => {
        try {
          const remote = await fetchEnrichmentMap()
          replaceEnrichmentMap(remote)
          const { voters: rows, meta: m, sourceLabel } = await loadBestVoters()
          applyLoaded(rows, m, sourceLabel)
        } catch (e) {
          console.warn('enrichment reload failed', e)
        }
      },
    })
  }, [dbLive, applyLoaded])

  const schedulePersistWorkingCopy = useCallback((nextVoters, nextMeta) => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistWorkingCopy(nextVoters, nextMeta).catch(() => {})
    }, 600)
  }, [])

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    },
    [],
  )

  const clearFilters = useCallback(() => {
    setQ('')
    setPart('')
    setSectionNo('')
    setGender('')
    setAgeBand('')
    setPcs([])
    setPollingStations([])
    setFamilyQ('')
    setFamilyMinSize(0)
    setFamilyOnlyUnlinked(false)
    setEnrichedOnly(false)
    setVoterStatus('')
  }, [])

  const getVoter = useCallback(
    (epic) => {
      if (!epic) return null
      const key = String(epic).toUpperCase()
      return voters.find((v) => v.epic === key) || null
    },
    [voters],
  )

  const openVoter = useCallback(
    (voterOrEpic, options = {}) => {
      if (!voterOrEpic) {
        setSelectedVoter(null)
        return
      }
      if (typeof voterOrEpic === 'object' && voterOrEpic.epic) {
        const base = getVoter(voterOrEpic.epic) || voterOrEpic
        setSelectedVoter({
          ...base,
          focusField: options.focusField || voterOrEpic.focusField || '',
        })
        return
      }
      const base = getVoter(voterOrEpic)
      setSelectedVoter(base ? { ...base, focusField: options.focusField || '' } : null)
    },
    [getVoter],
  )

  const closeVoter = useCallback(() => setSelectedVoter(null), [])

  const updateVoterEnrichment = useCallback(
    (epic, patch) => {
      const key = String(epic).toUpperCase()
      const saved = setEnrichment(epic, patch)
      setVoters((prev) => {
        const nextVoters = prev.map((v) => (v.epic === key ? applyRowToVoter(v, saved) : v))
        schedulePersistWorkingCopy(nextVoters, metaRef.current)
        return nextVoters
      })
      setSelectedVoter((cur) => (cur && cur.epic === key ? applyRowToVoter(cur, saved) : cur))

      if (isEnrichmentApiAvailable()) {
        putEnrichment(key, saved).catch((err) => {
          console.warn('Failed to persist enrichment to Postgres', err)
        })
      }
      return saved
    },
    [schedulePersistWorkingCopy],
  )

  const saveVotersVersion = useCallback(async () => {
    // Write into project public/data/ (voters_latest.json + versions backup)
    const result = await downloadVotersVersion(votersRef.current, metaRef.current)
    // Re-load from project latest so UI matches disk
    const { voters: rows, meta: m, sourceLabel } = await loadVotersFromJson(
      '/data/voters_latest.json',
      'voters_latest.json',
    )
    applyLoaded(rows, {
      ...m,
      versionLabel: `enriched_${result.version}`,
      exportedAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
      loadedFrom: 'voters_latest.json',
      projectPath: result.projectPath,
      isLatest: true,
    }, sourceLabel)
    return result
  }, [applyLoaded])

  const saveEnrichmentPatch = useCallback(() => {
    return downloadEnrichmentPatch()
  }, [])

  const listVersionBackups = useCallback(() => getVersionBackups(), [])

  const restoreVersionBackup = useCallback(
    async (id) => {
      const row = await restoreBrowserBackup(id)
      const { voters: rows, meta: m, sourceLabel } = loadVotersFromObject(
        { meta: row.meta || {}, voters: row.voters },
        `restored:${row.sourceLabel || id}`,
      )
      applyLoaded(rows, m, sourceLabel)
      return { sourceLabel, count: rows.length }
    },
    [applyLoaded],
  )

  const importVotersFile = useCallback(
    async (file) => {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data?.enrichment && !data?.voters) {
        throw new Error('This looks like a patch file. Use a full voters_enriched_*.json version.')
      }
      const { voters: rows, meta: m, sourceLabel } = loadVotersFromObject(data, file.name)
      applyLoaded(rows, m, sourceLabel)
      // Import becomes new latest; previous browser latest kept as backup
      await saveLatestDataset(
        buildDatasetPayload(rows.map(serializeVoter), m, { sourceLabel }),
        { keepBackup: true },
      )
      return { sourceLabel, count: rows.length }
    },
    [applyLoaded],
  )

  const resetToOriginalRoll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Backup current working copy before reset
      if (votersRef.current?.length) {
        await saveLatestDataset(
          buildDatasetPayload(
            votersRef.current.map(serializeVoter),
            { ...metaRef.current, exportedAt: new Date().toISOString() },
            { sourceLabel: `pre-reset:${dataSource || 'working'}` },
          ),
          { keepBackup: true },
        )
      }
      await clearLatestDataset()
      const { voters: rows, meta: m, sourceLabel } = await loadVotersFromJson(
        '/data/voters.json',
        'voters.json',
      )
      applyLoaded(rows, m, sourceLabel)
    } catch (e) {
      setError(e.message || 'Failed to reload original roll')
    } finally {
      setLoading(false)
    }
  }, [applyLoaded, dataSource])

  const stats = useMemo(() => computeStats(voters), [voters])
  const campaign = useMemo(() => buildCampaignStatus(voters), [voters])
  const families = useMemo(() => buildFamilies(voters), [voters])
  const famStats = useMemo(() => familyStats(families, voters.length), [families, voters.length])

  const filtered = useMemo(() => {
    const looksFullSection = String(sectionNo).includes('-') || /[A-Za-z]/.test(String(sectionNo))
    return filterVoters(voters, {
      q,
      part,
      section: looksFullSection ? sectionNo : '',
      sectionNo: looksFullSection ? '' : sectionNo,
      gender,
      ageBand,
      pcs,
      pollingStations,
      enrichedOnly,
      voterStatus,
    })
  }, [voters, q, part, sectionNo, gender, ageBand, pcs, pollingStations, enrichedOnly, voterStatus])

  const filteredFamilies = useMemo(
    () =>
      filterFamilies(families, {
        q: familyQ,
        part,
        minSize: familyMinSize,
        onlyUnlinked: familyOnlyUnlinked,
      }),
    [families, familyQ, part, familyMinSize, familyOnlyUnlinked],
  )

  const value = useMemo(
    () => ({
      voters,
      meta,
      dataSource,
      filtered,
      stats,
      campaign,
      families,
      famStats,
      filteredFamilies,
      loading,
      error,
      dbLive,
      filters: {
        q,
        part,
        sectionNo,
        gender,
        ageBand,
        pcs,
        pollingStations,
        familyQ,
        familyMinSize,
        familyOnlyUnlinked,
        enrichedOnly,
        voterStatus,
      },
      setQ,
      setPart,
      setSectionNo,
      setGender,
      setAgeBand,
      setPcs,
      setPollingStations,
      setFamilyQ,
      setFamilyMinSize,
      setFamilyOnlyUnlinked,
      setEnrichedOnly,
      setVoterStatus,
      clearFilters,
      getFamily: (id) => families.find((f) => f.id === id) || null,
      getVoter,
      selectedVoter,
      openVoter,
      closeVoter,
      updateVoterEnrichment,
      saveVotersVersion,
      saveEnrichmentPatch,
      listVersionBackups,
      restoreVersionBackup,
      importVotersFile,
      resetToOriginalRoll,
    }),
    [
      voters,
      meta,
      dataSource,
      filtered,
      stats,
      campaign,
      families,
      famStats,
      filteredFamilies,
      loading,
      error,
      dbLive,
      q,
      part,
      sectionNo,
      gender,
      ageBand,
      pcs,
      pollingStations,
      familyQ,
      familyMinSize,
      familyOnlyUnlinked,
      enrichedOnly,
      voterStatus,
      clearFilters,
      getVoter,
      selectedVoter,
      openVoter,
      closeVoter,
      updateVoterEnrichment,
      saveVotersVersion,
      saveEnrichmentPatch,
      listVersionBackups,
      restoreVersionBackup,
      importVotersFile,
      resetToOriginalRoll,
    ],
  )

  return <VoterDataContext.Provider value={value}>{children}</VoterDataContext.Provider>
}

export function useVoterData() {
  const ctx = useContext(VoterDataContext)
  if (!ctx) throw new Error('useVoterData must be used within VoterDataProvider')
  return ctx
}

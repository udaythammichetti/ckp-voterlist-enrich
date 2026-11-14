import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import { LocaleProvider } from './context/Locale'
import { VoterDataProvider } from './context/VoterData'
import Campaign from './pages/Campaign'
import Consolidated from './pages/Consolidated'
import Dashboard from './pages/Dashboard'
import Families from './pages/Families'
import FamilyDetail from './pages/FamilyDetail'
import Villages from './pages/Villages'
import VillageDetail from './pages/VillageDetail'
import Voters from './pages/Voters'
import Wards from './pages/Wards'
import WardDetail from './pages/WardDetail'
import './App.css'

export default function App() {
  return (
    <LocaleProvider>
      <VoterDataProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="voters" element={<Voters />} />
              <Route path="families" element={<Families />} />
              <Route path="families/:familyId" element={<FamilyDetail />} />
              <Route path="wards" element={<Wards />} />
              <Route path="wards/:wardId" element={<WardDetail />} />
              <Route path="villages" element={<Villages />} />
              <Route path="villages/:villageId" element={<VillageDetail />} />
              <Route path="campaign" element={<Campaign />} />
              <Route path="consolidated" element={<Consolidated />} />
              <Route path="validation" element={<Navigate to="/consolidated" replace />} />
              <Route path="parts" element={<Navigate to="/wards" replace />} />
              <Route path="parts/:wardId" element={<WardDetail />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </VoterDataProvider>
    </LocaleProvider>
  )
}

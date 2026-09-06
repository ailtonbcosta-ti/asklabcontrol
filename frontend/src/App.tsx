import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, Role } from './stores/auth';
import { Login } from './pages/Auth/Login';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard/Dashboard';
import { PatientsList } from './pages/Patients/PatientsList';
import { PatientForm } from './pages/Patients/PatientForm';
import { AuthorizationsList } from './pages/Authorizations/AuthorizationsList';
import { AuthorizationEmit } from './pages/Authorizations/AuthorizationEmit';
import { AuthorizationPrint } from './pages/Authorizations/AuthorizationPrint';
import { ContractsList } from './pages/Contracts/ContractsList';
import { ContractDetail } from './pages/Contracts/ContractDetail';
import { LaboratoriesList } from './pages/Contracts/LaboratoriesList';
import { ProceduresList } from './pages/Contracts/ProceduresList';
import { ReportsHome } from './pages/Reports/ReportsHome';
import { ReagentesHome } from './pages/Reagentes/ReagentesHome';
import { UsersList } from './pages/Users/UsersList';
import { Settings } from './pages/Settings/Settings';
import { SigtapManager } from './pages/Settings/SigtapManager';
import { PecSettings } from './pages/Settings/PecSettings';
import { BpaTerceirosHome } from './pages/BpaTerceiros/BpaTerceirosHome';

function Guard({ children, roles }: { children: JSX.Element; roles?: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/autorizacoes/:id/print" element={<Guard><AuthorizationPrint /></Guard>} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pacientes" element={<PatientsList />} />
        <Route path="/pacientes/novo" element={<PatientForm />} />
        <Route path="/pacientes/:id" element={<PatientForm />} />
        <Route path="/autorizacoes" element={<AuthorizationsList />} />
        <Route path="/autorizacoes/emitir" element={<AuthorizationEmit />} />
        <Route path="/contratos" element={<ContractsList />} />
        <Route path="/contratos/:id" element={<ContractDetail />} />
        <Route path="/laboratorios" element={<LaboratoriesList />} />
        <Route path="/procedimentos" element={<ProceduresList />} />
        <Route path="/relatorios" element={<Guard roles={['ADMIN', 'GESTOR']}><ReportsHome /></Guard>} />
        <Route path="/reagentes" element={<ReagentesHome />} />
        <Route path="/usuarios" element={<Guard roles={['ADMIN']}><UsersList /></Guard>} />
        <Route path="/configuracoes" element={<Guard roles={['ADMIN']}><Settings /></Guard>} />
        <Route path="/configuracoes/sigtap" element={<Guard roles={['ADMIN']}><SigtapManager /></Guard>} />
        <Route path="/configuracoes/pec" element={<Guard roles={['ADMIN']}><PecSettings /></Guard>} />
        <Route path="/bpa-terceiros" element={<Guard roles={['ADMIN', 'GESTOR']}><BpaTerceirosHome /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

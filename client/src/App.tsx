import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import RouteProgressBar from "./components/RouteProgressBar";

import AdminDashboard from "./pages/admin/AdminDashboard";
import SchoolsList from "./pages/admin/SchoolsList";
import CreateSchool from "./pages/admin/CreateSchool";
import SchoolDetail from "./pages/admin/SchoolDetail";
import SchoolHistory from "./pages/admin/SchoolHistory";
import CodesManagement from "./pages/admin/CodesManagement";
import CreateCodes from "./pages/admin/CreateCodes";
import RenewSchool from "./pages/admin/RenewSchool";
import AdminAccount from "./pages/admin/Account";
import AdminGuide from "./pages/admin/Guide";

import SchoolDashboard from "./pages/school/SchoolDashboard";
import SchoolCodes from "./pages/school/SchoolCodes";
import SchoolStudents from "./pages/school/SchoolStudents";
import SchoolSubscription from "./pages/school/SchoolSubscription";
import SchoolAccount from "./pages/school/Account";
import SchoolGuide from "./pages/school/Guide";

export default function App() {
  return (
    <>
    <RouteProgressBar />
    <Routes>
      {/* Public — marketing lives on censorx.in; the portal root goes straight to login */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Super Admin Portal */}
      <Route element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]} />}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/schools" element={<SchoolsList />} />
        <Route path="/admin/schools/create" element={<CreateSchool />} />
        <Route path="/admin/schools/:organizationId" element={<SchoolDetail />} />
        <Route path="/admin/schools/:organizationId/history" element={<SchoolHistory />} />
        <Route path="/admin/codes" element={<CodesManagement />} />
        <Route path="/admin/codes/create" element={<CreateCodes />} />
        <Route path="/admin/subscriptions" element={<RenewSchool />} />
        <Route path="/admin/account" element={<AdminAccount />} />
        <Route path="/admin/guide" element={<AdminGuide />} />
      </Route>

      {/* School Portal */}
      <Route element={<ProtectedRoute allowedRoles={["SCHOOL_ADMIN"]} />}>
        <Route path="/school" element={<SchoolDashboard />} />
        <Route path="/school/codes" element={<SchoolCodes />} />
        <Route path="/school/students" element={<SchoolStudents />} />
        <Route path="/school/subscription" element={<SchoolSubscription />} />
        <Route path="/school/account" element={<SchoolAccount />} />
        <Route path="/school/guide" element={<SchoolGuide />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </>
  );
}

import { Route, Routes } from "react-router-dom";
import PublicLayout from "./layouts/PublicLayout";
import Home from "./pages/Home";
import Features from "./pages/Features";
import Contact from "./pages/Contact";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import { ProtectedRoute } from "./routes/ProtectedRoute";

import AdminDashboard from "./pages/admin/AdminDashboard";
import SchoolsList from "./pages/admin/SchoolsList";
import CreateSchool from "./pages/admin/CreateSchool";
import SchoolDetail from "./pages/admin/SchoolDetail";
import SchoolHistory from "./pages/admin/SchoolHistory";
import CodesManagement from "./pages/admin/CodesManagement";
import CreateCodes from "./pages/admin/CreateCodes";
import RenewSchool from "./pages/admin/RenewSchool";
import AdminAccount from "./pages/admin/Account";

import SchoolDashboard from "./pages/school/SchoolDashboard";
import SchoolCodes from "./pages/school/SchoolCodes";
import SchoolStudents from "./pages/school/SchoolStudents";
import SchoolSubscription from "./pages/school/SchoolSubscription";
import SchoolAccount from "./pages/school/Account";

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/contact" element={<Contact />} />
      </Route>
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
      </Route>

      {/* School Portal */}
      <Route element={<ProtectedRoute allowedRoles={["SCHOOL_ADMIN"]} />}>
        <Route path="/school" element={<SchoolDashboard />} />
        <Route path="/school/codes" element={<SchoolCodes />} />
        <Route path="/school/students" element={<SchoolStudents />} />
        <Route path="/school/subscription" element={<SchoolSubscription />} />
        <Route path="/school/account" element={<SchoolAccount />} />
      </Route>

      <Route path="*" element={<Home />} />
    </Routes>
  );
}

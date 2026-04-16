import { Navigate, Route, Routes } from "react-router";
import { AuthGuard } from "@/components/AuthGuard";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { AdvisorPage } from "@/pages/AdvisorPage";
import { CoachingPage } from "@/pages/CoachingPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { H2LogMealPage } from "@/pages/H2LogMealPage";
import { LogMealPage } from "@/pages/LogMealPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { ProfilePage } from "@/pages/ProfilePage";

export function App() {
  return (
    <Routes>
      {/* Rutas públicas */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />

      {/* Rutas protegidas */}
      <Route element={<AuthGuard />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/advisor" element={<AdvisorPage />} />
          <Route path="/log" element={<LogMealPage />} />
          <Route path="/log/h2" element={<H2LogMealPage />} />
          <Route path="/coaching" element={<CoachingPage />} />
          <Route path="/me" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

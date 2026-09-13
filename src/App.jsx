// src/App.jsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { ConfirmProvider } from './context/ConfirmContext';
import ProtectedRoute, { RequireAuth } from './components/ProtectedRoute';

import Login from './pages/Login';
import StudentLogin from './pages/StudentLogin';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import StudentLesson from './pages/StudentLesson';
import GoRedirect from './pages/GoRedirect';

import ChangePassword from './pages/ChangePassword';

import TeacherDashboard from './pages/TeacherDashboard';
import LessonBuilder from './pages/LessonBuilder';
import LessonResults from './pages/LessonResults';
import LessonLibrary from './pages/LessonLibrary';
import PublicLessonLibrary from './pages/PublicLessonLibrary';
import TeacherClasses from './pages/TeacherClasses';
import TeacherClassHome from './pages/TeacherClassHome';
import TeacherCsvImport from './pages/TeacherCsvImport';
import TeacherAssignmentNew from './pages/TeacherAssignmentNew';
import TeacherAssignmentDetail from './pages/TeacherAssignmentDetail';
import TeacherCalendar from './pages/TeacherCalendar';

import StudentDashboard from './pages/StudentDashboard';
import StudentAssignmentDetail from './pages/StudentAssignmentDetail';
import StudentCalendar from './pages/StudentCalendar';

import Payment from './components/Payment';
import PaymentSuccess from './components/PaymentSuccess';

function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/student-login" element={<StudentLogin />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/lesson/:slug" element={<StudentLesson />} />
          <Route path="/go/:slug" element={<GoRedirect />} />

          <Route element={<RequireAuth />}>
            <Route path="/change-password" element={<ChangePassword />} />
          </Route>

          <Route element={<ProtectedRoute requiredRole="teacher" />}>
            <Route path="/" element={<TeacherDashboard />} />
            <Route path="/builder" element={<LessonBuilder />} />
            <Route path="/builder/:id" element={<LessonBuilder />} />
            <Route path="/results/:lessonId" element={<LessonResults />} />
            <Route path="/library" element={<LessonLibrary />} />
            <Route path="/public-library" element={<PublicLessonLibrary />} />

            <Route path="/classes" element={<TeacherClasses />} />
            <Route path="/classes/:id" element={<TeacherClassHome />} />
            <Route path="/classes/:id/import" element={<TeacherCsvImport />} />
            <Route
              path="/classes/:id/assignments/new"
              element={<TeacherAssignmentNew />}
            />
            <Route
              path="/classes/:id/assignments/:assignmentId"
              element={<TeacherAssignmentDetail />}
            />

            <Route path="/calendar" element={<TeacherCalendar />} />

            <Route path="/payment" element={<Payment amount={1000} />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
          </Route>

          <Route element={<ProtectedRoute requiredRole="student" />}>
            <Route path="/student" element={<StudentDashboard />} />
            <Route
              path="/student/assignments/:assignmentId"
              element={<StudentAssignmentDetail />}
            />
            <Route path="/student/calendar" element={<StudentCalendar />} />
          </Route>

          <Route
            path="*"
            element={
              <div className="p-8 text-center text-gray-500">Page not found</div>
            }
          />
        </Routes>
      </ConfirmProvider>
    </AuthProvider>
  );
}

export default App;
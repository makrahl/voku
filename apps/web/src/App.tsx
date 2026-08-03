import { Navigate, Route, Routes } from 'react-router';
import { AdminApp } from './admin/AdminApp.tsx';
import { StudentApp } from './student/StudentApp.tsx';

export function App() {
  return (
    <Routes>
      {/* Two apps, one origin: /s/* is the student, everything else is the teacher. */}
      <Route path="/s/*" element={<StudentApp />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

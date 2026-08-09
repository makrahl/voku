import { Route, Routes } from 'react-router';
import { AdminApp } from './admin/AdminApp.tsx';
import { StudentApp } from './student/StudentApp.tsx';
import { Landing } from './Landing.tsx';

export function App() {
  return (
    <Routes>
      {/* Two apps on one origin: /s/* is the student, /admin/* is the teacher.
          The root is a signpost between them — sending everyone to the teacher
          login would meet most visitors with a password they do not have. */}
      <Route path="/s/*" element={<StudentApp />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}

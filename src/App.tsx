import { BrowserRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./lib/i18n";
import { HomePage } from "./pages/HomePage";
import { Missing } from "./pages/Missing";
import { ProjectPage } from "./pages/ProjectPage";

export function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="*" element={<Missing />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}

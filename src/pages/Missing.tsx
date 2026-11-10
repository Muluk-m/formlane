import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";

export function Missing() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div>
        <h1 className="font-serif text-4xl">{t("notFound")}</h1>
        <Link to="/" className="mt-4 inline-block text-accent">
          {t("home")}
        </Link>
      </div>
    </main>
  );
}

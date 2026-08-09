import { Link, useLocation } from 'react-router';
import { cx } from '../components/ui.tsx';

/**
 * Shared frame for the two instance-wide admin pages. They are siblings, so a
 * tab strip lets you move between them without going back through the account
 * menu each time.
 */
const TABS = [
  { to: '/admin/settings/llm', label: 'Language model' },
  { to: '/admin/settings/teachers', label: 'Teachers' },
] as const;

export function AdminSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <span className="label">Admin</span>
        <h1 className="text-hero">{title}</h1>
        {intro ? <p className="max-w-prose text-ink-60">{intro}</p> : null}
      </div>

      <nav className="rule-b flex flex-wrap gap-8 pb-4">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={cx(
              'label py-1 transition-colors',
              pathname.startsWith(tab.to) ? '!text-ink border-b-2 border-accent' : 'hover:!text-ink',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}

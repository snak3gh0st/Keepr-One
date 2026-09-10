/**
 * Every agent route renders dynamically, so a tab switch waits on the server
 * before React has anything to paint. Without this boundary the router keeps
 * the previous tab on screen for the whole wait and the app reads as frozen.
 *
 * The skeleton mirrors the Shell's geometry — dark rail at 272px, 72px topbar,
 * same content gutters — because the Shell is rendered by each page rather than
 * by the layout, so it is replaced along with the page during the transition.
 */
export default function AgentLoading() {
  return (
    <div
      className="agent-shell min-h-full w-full bg-canvas md:flex"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Carregando</span>

      {/* Mobile header rail */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-4 py-2.5 md:hidden">
        <span className="skeleton-bar h-6 w-28 rounded-full bg-white/[0.14]" />
        <span className="skeleton-bar h-9 w-9 rounded-full bg-white/[0.10]" />
      </div>

      {/* Sidebar */}
      <div
        aria-hidden
        className="hidden shrink-0 border-r border-white/[0.07] bg-[#090909] md:sticky md:top-0 md:block md:h-screen md:w-[272px]"
      >
        <div className="px-6 pb-9 pt-7">
          <span className="skeleton-bar block h-7 w-32 rounded-lg bg-white/[0.14]" />
          <div className="mt-7 rounded-2xl border border-white/[0.11] bg-white/[0.035] px-4 py-3.5">
            <span className="skeleton-bar block h-2.5 w-20 rounded-full bg-white/[0.10]" />
            <span className="skeleton-bar mt-2.5 block h-3.5 w-32 rounded-full bg-white/[0.14]" />
          </div>
        </div>
        <div className="px-6 pb-3">
          <span className="skeleton-bar block h-2.5 w-16 rounded-full bg-white/[0.10]" />
        </div>
        <ul className="flex flex-col gap-1.5 px-3">
          {Array.from({ length: 9 }, (_, index) => (
            <li key={index} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <span className="skeleton-bar h-5 w-5 shrink-0 rounded-md bg-white/[0.10]" />
              <span
                className="skeleton-bar h-3.5 rounded-full bg-white/[0.10]"
                style={{ width: `${58 + ((index * 17) % 46)}px` }}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Main column */}
      <div className="min-w-0 w-full max-w-full flex-1 overflow-x-hidden bg-canvas pb-24 md:pb-0">
        <div className="sticky top-0 z-20 border-b border-border-steel/65 bg-canvas/88 px-4 backdrop-blur-xl sm:px-6 md:px-9 lg:px-12">
          <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="skeleton-bar block h-2.5 w-24 rounded-full" />
              <span className="skeleton-bar block h-4 w-52 rounded-full" />
            </div>
            <div className="flex items-center gap-3">
              <span className="skeleton-bar h-9 w-9 rounded-full" />
              <span className="skeleton-bar hidden h-9 w-28 rounded-full sm:block" />
            </div>
          </div>
        </div>

        <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-8 sm:px-6 md:px-9 lg:px-12">
          <div className="flex flex-col gap-3">
            <span className="skeleton-bar block h-7 w-64 max-w-full rounded-lg" />
            <span className="skeleton-bar block h-4 w-96 max-w-full rounded-full" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-2xl border border-border-steel/65 bg-paper p-5"
              >
                <span className="skeleton-bar block h-2.5 w-20 rounded-full" />
                <span className="skeleton-bar block h-8 w-24 rounded-lg" />
                <span className="skeleton-bar block h-3 w-28 rounded-full" />
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border-steel/65 bg-paper">
            <div className="flex items-center justify-between gap-4 border-b border-border-steel/65 px-5 py-4">
              <span className="skeleton-bar block h-4 w-40 rounded-full" />
              <span className="skeleton-bar block h-8 w-24 rounded-full" />
            </div>
            <div className="flex flex-col">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 border-b border-border-steel/45 px-5 py-4 last:border-b-0"
                >
                  <span className="skeleton-bar h-9 w-9 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <span
                      className="skeleton-bar block h-3.5 rounded-full"
                      style={{ width: `${42 + ((index * 23) % 34)}%` }}
                    />
                    <span
                      className="skeleton-bar block h-3 rounded-full"
                      style={{ width: `${26 + ((index * 19) % 22)}%` }}
                    />
                  </div>
                  <span className="skeleton-bar hidden h-6 w-20 shrink-0 rounded-full sm:block" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

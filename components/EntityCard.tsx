"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

export function EntityCardList({ children }: { children: React.ReactNode }) {
  return <ul className="module-entity-list">{children}</ul>;
}

export function EntityCard({
  children,
  index = 0,
  href,
  className = "",
}: {
  children: React.ReactNode;
  index?: number;
  href?: string;
  className?: string;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const body = (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.25, delay: Math.min(index, 20) * 0.02, ease: "easeOut" }}
      data-clickable={href ? true : undefined}
      className={`module-entity-card group ${className}`}
    >
      {children}
    </motion.div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="module-entity-link">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

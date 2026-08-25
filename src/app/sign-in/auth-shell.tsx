import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { SignInSurface } from "@/lib/sign-in-surface";
import { cn } from "@/lib/utils";
import factoryStyles from "../factory-surface.module.css";

export function AuthShell({
  surface,
  backHref,
  children,
}: {
  surface: SignInSurface;
  backHref: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        "min-h-screen",
        surface.inverse && factoryStyles.factoryShell,
      )}
    >
      <header
        className={cn(
          "flex h-16 items-center gap-4 border-b px-5",
          surface.inverse && "border-white/10",
        )}
      >
        <Button
          render={
            <Link
              href={backHref}
              prefetch={false}
              aria-label={`Back to ${surface.brand.name}`}
            />
          }
          nativeButton={false}
          variant="ghost"
          size="icon-sm"
          className={
            surface.inverse
              ? "text-white hover:bg-white/8 hover:text-white"
              : undefined
          }
        >
          <ArrowLeft />
        </Button>
        <Brand {...surface.brand} inverse={surface.inverse} prefetch={false} />
      </header>
      <div
        className={cn(
          "grid min-h-[calc(100vh-4rem)] place-items-center px-5 py-16",
          surface.inverse && factoryStyles.factoryGrid,
        )}
      >
        {children}
      </div>
    </main>
  );
}

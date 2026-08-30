import { notFound } from "next/navigation";
import { FactoryAnalytics } from "@/components/factory-analytics";
import { NicheFontScope } from "@/components/fonts/niche-font-scope";
import { resolveVerticalBySlug } from "@/lib/verticals/registry";

export default async function NicheLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ vertical: string }>;
}) {
  const { vertical } = await params;
  const id = resolveVerticalBySlug(vertical);
  if (!id) notFound();

  return (
    <NicheFontScope vertical={id}>
      <FactoryAnalytics />
      {children}
    </NicheFontScope>
  );
}

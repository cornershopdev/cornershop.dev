import { FactoryAnalytics } from "@/components/factory-analytics";

export default function ThemesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <FactoryAnalytics />
      {children}
    </>
  );
}

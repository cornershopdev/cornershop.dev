import { FactoryAnalytics } from "@/components/factory-analytics";
import { AuthFontScope } from "@/components/fonts/auth-font-scope";

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthFontScope>
      <FactoryAnalytics />
      {children}
    </AuthFontScope>
  );
}

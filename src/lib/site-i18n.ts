import type { SiteUiLocale } from "@/lib/site-locales";
import type { ErasedVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalTemplateCopy } from "@/lib/verticals/types";

/**
 * Picks the best entry from a locale-keyed record: exact locale, then the bare
 * language, then `en`, then whatever the vertical shipped first. This replaces the
 * old hardcoded `fr`-or-`en` branch — with the same outcome for the restaurant
 * dictionaries (`fr`/`fr-FR` → fr, everything else → en) — so a vertical that
 * ships more locales, or fewer, needs no renderer change. `SITE_UI_LOCALES` names
 * which locales that is; this function is what makes an unshipped one degrade
 * rather than crash.
 */
function pickLocaleEntry<T>(byLocale: Record<string, T>, locale: string): T {
  const normalized = locale.toLowerCase();
  return (
    byLocale[normalized] ??
    byLocale[normalized.split("-")[0]] ??
    byLocale.en ??
    Object.values(byLocale)[0]
  );
}

/**
 * Copy that belongs to the engine rather than to any one vertical.
 *
 * The booking-request form is the same form for a bistro and a barbershop — the
 * fields, the states, and the failure text do not change with the trade. Only the
 * headings around it do, and those live in each vertical's own dictionary. Keeping
 * these here means vertical #2 inherits a fully translated form instead of
 * copying fourteen strings it has no reason to phrase differently.
 */
const sharedSiteDictionary = {
  en: {
    bookingRequestName: "Your name",
    bookingRequestEmail: "Email",
    bookingRequestPhone: "Phone",
    bookingRequestWhen: "Preferred time",
    bookingRequestPartySize: "Number of people",
    bookingRequestNotes: "Anything we should know?",
    bookingRequestOptional: "optional",
    bookingRequestSubmit: "Send request",
    bookingRequestSending: "Sending…",
    bookingRequestSuccess: "Thanks — we'll be in touch shortly.",
    bookingRequestError: "Your request could not be sent. Try again.",
    bookingRequestPreviewNotice: "This is a preview — requests are not sent.",
    bookingEmbedPreviewNotice: "Booking widget shown on the live site.",
    pickupHeading: "Pickup",
    blogNav: "Blog",
  },
  fr: {
    bookingRequestName: "Votre nom",
    bookingRequestEmail: "E-mail",
    bookingRequestPhone: "Téléphone",
    bookingRequestWhen: "Créneau souhaité",
    bookingRequestPartySize: "Nombre de personnes",
    bookingRequestNotes: "Autre chose à nous signaler ?",
    bookingRequestOptional: "facultatif",
    bookingRequestSubmit: "Envoyer la demande",
    bookingRequestSending: "Envoi…",
    bookingRequestSuccess: "Merci — nous vous répondrons rapidement.",
    bookingRequestError:
      "Votre demande n'a pas pu être envoyée. Réessayez.",
    bookingRequestPreviewNotice:
      "Ceci est un aperçu — les demandes ne sont pas envoyées.",
    bookingEmbedPreviewNotice:
      "Widget de réservation affiché sur le site en ligne.",
    pickupHeading: "Retrait",
    blogNav: "Blog",
  },
  mt: {
    bookingRequestName: "Ismek",
    bookingRequestEmail: "Email",
    bookingRequestPhone: "Telefon",
    bookingRequestWhen: "Ħin preferut",
    bookingRequestPartySize: "Numru ta’ persuni",
    bookingRequestNotes: "Hemm xi ħaġa li għandna nkunu nafu?",
    bookingRequestOptional: "mhux obbligatorju",
    bookingRequestSubmit: "Ibgħat it-talba",
    bookingRequestSending: "Qed tintbagħat…",
    bookingRequestSuccess: "Grazzi — nikkuntattjawk dalwaqt.",
    bookingRequestError:
      "It-talba tiegħek ma setgħetx tintbagħat. Erġa’ pprova.",
    bookingRequestPreviewNotice:
      "Din hija previżjoni — it-talbiet ma jintbagħtux.",
    bookingEmbedPreviewNotice:
      "Il-widget tal-ibbukkjar jintwera fis-sit pubblikat.",
    pickupHeading: "Ġbir",
    blogNav: "Blog",
  },
} satisfies Record<SiteUiLocale, Record<string, string>>;

/**
 * Shared copy first, the vertical's own copy on top: a vertical may override any
 * engine string it wants to phrase differently, but never has to restate the ones
 * it doesn't.
 */
export function getSiteDictionary(
  config: ErasedVerticalConfig,
  locale: string,
): Record<string, string> {
  return {
    ...pickLocaleEntry(sharedSiteDictionary, locale),
    ...pickLocaleEntry(config.i18n, locale),
  };
}

export function getTemplateCopy(
  template: { copy: Record<string, VerticalTemplateCopy> },
  locale: string,
): VerticalTemplateCopy {
  return pickLocaleEntry(template.copy, locale);
}

export function localizeIntegrationUrl(url: string, locale: string): string {
  try {
    const localizedUrl = new URL(url);
    if (!localizedUrl.searchParams.has("lang")) return url;
    localizedUrl.searchParams.set("lang", locale.split("-")[0].toLowerCase());
    return localizedUrl.toString();
  } catch {
    return url;
  }
}

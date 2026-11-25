import type { KnowledgeBase, Lang } from "../../kb/schema.ts";

export type Labels = {
  cv: string;
  photo: string;
  location: string;
  email: string;
  phone: string;
  links: string;
  birthDate: string;
  nationality: string;
  workPermit: string;
  profile: string;
  experience: string;
  projects: string;
  skills: string;
  levels: Record<KnowledgeBase["skills"][number]["level"], string>;
  education: string;
  certifications: string;
  languages: string;
  native: string;
  references: string;
  certificates: string;
  present: string;
  until: string;
  validUntil: string;
  expired: string;
  subject: (title: string | null) => string;
  salutation: string;
  opening: (title: string | null, company: string | null) => string;
  invitation: string;
  closing: string;
};

export const LABELS: Record<Lang, Labels> = {
  it: {
    cv: "Curriculum vitae",
    photo: "Foto",
    location: "Domicilio",
    email: "E-mail",
    phone: "Telefono",
    links: "Link",
    birthDate: "Data di nascita",
    nationality: "Nazionalità",
    workPermit: "Permesso di lavoro",
    profile: "Profilo",
    experience: "Esperienze professionali",
    projects: "Progetti",
    skills: "Competenze",
    levels: { basic: "base", working: "operativo", advanced: "avanzato", expert: "esperto" },
    education: "Formazione",
    certifications: "Certificazioni",
    languages: "Lingue",
    native: "madrelingua",
    references: "Certificati di lavoro",
    certificates: "I certificati di lavoro sono disponibili su richiesta.",
    present: "oggi",
    until: "fino a",
    validUntil: "valida fino a",
    expired: "scaduta",
    subject: (title) => (title ? `Candidatura: ${title}` : "Candidatura"),
    salutation: "Gentili Signore, egregi Signori,",
    opening: (title, company) =>
      `mi candido per la posizione ${title ? `«${title}»` : "pubblicata"}${company ? ` presso ${company}` : ""}.`,
    invitation: "Resto volentieri a disposizione per un colloquio.",
    closing: "Cordiali saluti",
  },
  en: {
    cv: "Curriculum vitae",
    photo: "Photo",
    location: "Location",
    email: "Email",
    phone: "Phone",
    links: "Links",
    birthDate: "Date of birth",
    nationality: "Nationality",
    workPermit: "Work permit",
    profile: "Profile",
    experience: "Professional experience",
    projects: "Projects",
    skills: "Skills",
    levels: {
      basic: "basic",
      working: "working knowledge",
      advanced: "advanced",
      expert: "expert",
    },
    education: "Education",
    certifications: "Certifications",
    languages: "Languages",
    native: "native",
    references: "Work certificates",
    certificates: "Work certificates are available on request.",
    present: "present",
    until: "until",
    validUntil: "valid until",
    expired: "expired",
    subject: (title) => (title ? `Application: ${title}` : "Application"),
    salutation: "Dear Sir or Madam,",
    opening: (title, company) =>
      `I am applying for the ${title ? `position “${title}”` : "advertised position"}${company ? ` at ${company}` : ""}.`,
    invitation: "I would welcome the opportunity to discuss this in an interview.",
    closing: "Kind regards",
  },
  // Swiss spelling: "ss" instead of "ß", and no comma after salutation and closing.
  de: {
    cv: "Lebenslauf",
    photo: "Foto",
    location: "Wohnort",
    email: "E-Mail",
    phone: "Telefon",
    links: "Links",
    birthDate: "Geburtsdatum",
    nationality: "Nationalität",
    workPermit: "Arbeitsbewilligung",
    profile: "Profil",
    experience: "Berufserfahrung",
    projects: "Projekte",
    skills: "Kenntnisse",
    levels: {
      basic: "Grundkenntnisse",
      working: "praktische Kenntnisse",
      advanced: "fortgeschritten",
      expert: "Expertenniveau",
    },
    education: "Ausbildung",
    certifications: "Zertifizierungen",
    languages: "Sprachen",
    native: "Muttersprache",
    references: "Arbeitszeugnisse",
    certificates: "Arbeitszeugnisse sind auf Anfrage erhältlich.",
    present: "heute",
    until: "bis",
    validUntil: "gültig bis",
    expired: "abgelaufen",
    subject: (title) => (title ? `Bewerbung: ${title}` : "Bewerbung"),
    salutation: "Sehr geehrte Damen und Herren",
    opening: (title, company) =>
      `Ich bewerbe mich um die ${title ? `Stelle «${title}»` : "ausgeschriebene Stelle"}${company ? ` bei ${company}` : ""}.`,
    invitation: "Über die Einladung zu einem Gespräch freue ich mich.",
    closing: "Freundliche Grüsse",
  },
};

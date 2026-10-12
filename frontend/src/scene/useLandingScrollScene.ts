import { useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export type LandingChapter = "kenali" | "laporkan" | "pantau" | "selesai";

const chapters: LandingChapter[] = ["kenali", "laporkan", "pantau", "selesai"];

export function useLandingScrollScene() {
  const [progress, setProgress] = useState(0);
  const [footerVisible, setFooterVisible] = useState(false);
  const [activeChapter, setActiveChapter] = useState<LandingChapter>("kenali");
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const footer = document.querySelector(".landing-footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => {
      setFooterVisible(entry.isIntersecting);
    }, { rootMargin: "0px 0px 120px 0px", threshold: 0 });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(media.matches);
    media.addEventListener("change", updateMotion);
    return () => media.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".landing-page");
    const chapterElements = gsap.utils.toArray<HTMLElement>("[data-landing-chapter]");
    if (!root || reducedMotion) {
      setProgress(0);
      return;
    }

    const context = gsap.context(() => {
      ScrollTrigger.create({
        trigger: root,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => setProgress(self.progress),
      });

      chapterElements.forEach((element, index) => {
        ScrollTrigger.create({
          trigger: element,
          start: "top center",
          end: "bottom center",
          onEnter: () => setActiveChapter(chapters[index] ?? "kenali"),
          onEnterBack: () => setActiveChapter(chapters[index] ?? "kenali"),
        });

        if (index > 0) {
          const card = element.querySelector<HTMLElement>(".story-card");
          const note = element.querySelector<HTMLElement>(".story-note");
          const targets = [card, note].filter((target): target is HTMLElement => Boolean(target));
          if (targets.length) {
            gsap.fromTo(
              targets,
              { y: 22, autoAlpha: 0.76 },
              {
                y: 0,
                autoAlpha: 1,
                duration: 0.72,
                stagger: 0.08,
                ease: "power2.out",
                scrollTrigger: { trigger: element, start: "top 74%", once: true },
              },
            );
          }
        }
      });
    }, root);

    return () => context.revert();
  }, [reducedMotion]);

  return { progress, activeChapter, reducedMotion, footerVisible };
}

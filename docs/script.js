document.addEventListener("DOMContentLoaded", () => {
  // 滚动显示动画 (Intersection Observer)
  const reveals = document.querySelectorAll(".reveal");

  const revealObserver = new IntersectionObserver(
    (entries, _observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("active");
          // 可选：如果只想触发一次，可以取消观察
          // _observer.unobserve(entry.target);
        }
      });
    },
    {
      root: null,
      threshold: 0.15, // 元素出现 15% 时触发
      rootMargin: "0px 0px -50px 0px",
    },
  );

  reveals.forEach((element) => {
    revealObserver.observe(element);
  });

  // 导航栏平滑滚动
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href");
      if (targetId === "#") return;

      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: "smooth",
        });
      }
    });
  });
});

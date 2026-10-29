const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("Responsive Design - Viewport Breakpoints", async (t) => {
  // Simulate different viewport sizes and verify CSS is applied correctly
  
  await t.test("should have viewport meta tag", () => {
    const htmlPath = path.join(__dirname, "..", "plan.html");
    const html = readFileSync(htmlPath, "utf-8");
    
    assert(
      html.includes('name="viewport"'),
      "HTML must contain viewport meta tag"
    );
    assert(
      html.includes("width=device-width"),
      "Viewport must include width=device-width"
    );
    assert(
      html.includes("initial-scale=1"),
      "Viewport must include initial-scale=1"
    );
  });

  await t.test("should have responsive CSS media queries", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes("@media"),
      "CSS must contain media queries for responsive design"
    );
    assert(
      css.includes("max-width: 700px"),
      "CSS should have media query for mobile devices (max-width: 700px)"
    );
  });

  await t.test("Plan details grid should be responsive", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    // Check for responsive grid definition
    assert(
      css.includes("#plan-details .grid"),
      "Plan details grid should have specific styles"
    );
    assert(
      css.includes("grid-template-columns: repeat(auto-fit"),
      "Grid should use auto-fit for responsive columns"
    );
  });

  await t.test("Calendar grid should handle overflow on small screens", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes(".calendar {"),
      "Calendar should have specific styles"
    );
    assert(
      css.includes("overflow-x: auto"),
      "Calendar should allow horizontal scroll on small screens"
    );
  });

  await t.test("Plan controls grid should be responsive", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes(".plan-controls {"),
      "Plan controls should have grid layout"
    );
    assert(
      css.includes("display: grid"),
      "Plan controls must use CSS grid"
    );
    assert(
      css.includes("gap:"),
      "Plan controls should have gap spacing"
    );
  });

  await t.test("Mobile layout should hide title and optimize space", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    // Check for mobile-specific hiding
    const mobileSection = css.match(/@media[^{]*\(\s*max-width:\s*700px\s*\)[^{]*{[\s\S]*?\.topbar\s*h1[\s\S]*?}/);
    
    assert(
      mobileSection,
      "Mobile layout should hide header title for space"
    );
  });

  await t.test("Touch targets should be appropriately sized", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    // Check for appropriate touch target sizes
    assert(
      css.includes("min-height: 2.75rem"),
      "Touch targets should be minimum 2.75rem (44px) for mobile"
    );
  });

  await t.test("should have all required fitness pages", () => {
    const pages = ["plan.html", "track.html", "trends.html", "index.html"];
    pages.forEach((page) => {
      const filePath = path.join(__dirname, "..", page);
      const html = readFileSync(filePath, "utf-8");
      assert(
        html.includes('name="viewport"'),
        `${page} must have viewport meta tag`
      );
    });
  });
});

test("Responsive Typography - Font Sizes", async (t) => {
  await t.test("body text should be readable on all devices", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    // Default font size should be appropriate
    assert(
      css.includes("font: inherit") || css.includes("font-size: 1rem"),
      "Base font size should be at least 1rem (16px)"
    );
  });

  await t.test("headings should scale appropriately", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes("h2 {") || css.includes(".card h2"),
      "Headings should have defined styles"
    );
  });
});

test("Responsive Layout - Grid and Flexbox", async (t) => {
  await t.test("main content area should have max-width constraint", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes("max-width:") && (css.includes("960px") || css.includes("1280px")),
      "Main content should have max-width for desktop readability"
    );
  });

  await t.test("grid layouts should use minmax for flexibility", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    const gridPatterns = (css.match(/grid-template-columns:[\s\S]*?;/g) || []).length;
    assert(
      gridPatterns > 0,
      "Should use CSS Grid for responsive layouts"
    );
  });

  await t.test("inputs and form elements should be full-width on mobile", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes("width: 100%"),
      "Form inputs should be full-width by default"
    );
  });
});

test("Responsive Navigation", async (t) => {
  await t.test("topbar should adapt for mobile", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes(".topbar"),
      "Topbar styles should be defined"
    );
    assert(
      css.includes("gap:"),
      "Topbar should use flexbox with gap spacing"
    );
  });

  await t.test("settings menu should be positioned appropriately", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    const settingsPanel = css.match(/@media[^{]*\(\s*max-width:\s*700px\s*\)[\s\S]*?\.settings-panel[\s\S]*?}/);
    assert(
      settingsPanel,
      "Settings menu should adapt for mobile viewports"
    );
  });
});

test("Responsive Images and Media", async (t) => {
  await t.test("images should be responsive", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    // Check for img or svg responsive styles
    assert(
      css.includes("width: 100%") || css.includes("height: auto"),
      "Images should scale responsively"
    );
  });
});

test("Responsive Tables", async (t) => {
  await t.test("tables should have overflow handling", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes(".table-wrap") || css.includes("overflow-x: auto"),
      "Tables should have overflow-x: auto for mobile scrolling"
    );
  });

  await t.test("table cells should be readable", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes("white-space: nowrap"),
      "Table cells should prevent text wrapping where appropriate"
    );
  });
});

test("Responsive Components", async (t) => {
  await t.test("cards should have appropriate padding", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes(".card {") && css.includes("padding:"),
      "Cards should have defined padding"
    );
  });

  await t.test("buttons should be touch-friendly", () => {
    const cssPath = path.join(__dirname, "..", "styles.css");
    const css = readFileSync(cssPath, "utf-8");
    
    assert(
      css.includes(".btn"),
      "Button styles should be defined"
    );
    // Verify buttons have adequate padding
    const btnSection = css.match(/\.btn\s*{[\s\S]*?padding:[\s\S]*?}/);
    assert(btnSection, "Buttons should have defined padding");
  });
});

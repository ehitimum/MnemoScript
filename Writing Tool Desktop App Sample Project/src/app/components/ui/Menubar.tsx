import { useState } from "react";

const menuItems = [
  {
    label: "File",
    items: [
      "New Project",
      "Open Project",
      "Save",
      "Save As",
      "---",
      "Export",
      "---",
      "Close",
    ],
  },
  {
    label: "Edit",
    items: ["Undo", "Redo", "---", "Cut", "Copy", "Paste", "---", "Find", "Replace"],
  },
  {
    label: "View",
    items: ["Explorer", "Search", "Source Control", "---", "Appearance", "Layout"],
  },
  {
    label: "Tools",
    items: ["Word Count", "Spell Check", "Grammar Check", "---", "Settings"],
  },
  {
    label: "Help",
    items: ["Documentation", "Keyboard Shortcuts", "---", "About"],
  },
];

export function Menubar() {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1">
      {menuItems.map((menu) => (
        <div key={menu.label} className="relative">
          <button
            className={`px-3 py-1 text-sm hover:bg-[#2a2d2e] rounded ${
              activeMenu === menu.label ? "bg-[#2a2d2e]" : ""
            }`}
            onMouseEnter={() => setActiveMenu(menu.label)}
            onMouseLeave={() => setActiveMenu(null)}
          >
            {menu.label}
          </button>

          {activeMenu === menu.label && (
            <div
              className="absolute top-full left-0 mt-1 w-48 bg-[#252526] border border-[#454545] shadow-lg rounded z-50"
              onMouseEnter={() => setActiveMenu(menu.label)}
              onMouseLeave={() => setActiveMenu(null)}
            >
              {menu.items.map((item, index) => (
                <div key={index}>
                  {item === "---" ? (
                    <div className="h-px bg-[#454545] my-1" />
                  ) : (
                    <button className="w-full text-left px-4 py-2 text-sm hover:bg-[#2a2d2e]">
                      {item}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

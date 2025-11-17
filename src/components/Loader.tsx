import { useState, useEffect } from "react";

type LoaderProps = {
  type?: "default" | "redirect" | "content";
  text?: string;
  size?: "sm" | "md" | "lg";
  color?: "primary" | "secondary" | "success" | "danger";
};

const Loader = ({
  type = "default",
  text = "",
  size = "md",
  color = "primary",
}: LoaderProps) => {
  const [progress, setProgress] = useState(0);

  // Simulated progress for redirect loaders
  useEffect(() => {
    if (type === "redirect") {
      const interval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + 2;
          if (newProgress >= 100) {
            clearInterval(interval);
            return 100;
          }
          return newProgress;
        });
      }, 50);

      return () => clearInterval(interval);
    }
  }, [type]);

  // Size mappings
  const sizeMap = {
    sm: {
      container: "h-16 w-16",
      ring: "h-14 w-14",
      inner: "h-10 w-10",
      text: "text-xs",
    },
    md: {
      container: "h-24 w-24",
      ring: "h-20 w-20",
      inner: "h-16 w-16",
      text: "text-sm",
    },
    lg: {
      container: "h-32 w-32",
      ring: "h-28 w-28",
      inner: "h-24 w-24",
      text: "text-base",
    },
  };

  // Color mappings
  const colorMap = {
    primary: {
      ring: "border-emerald-500",
      pulse: "bg-emerald-500",
      text: "text-emerald-500",
    },
    secondary: {
      ring: "border-purple-500",
      pulse: "bg-purple-500",
      text: "text-purple-500",
    },
    success: {
      ring: "border-green-500",
      pulse: "bg-green-500",
      text: "text-green-500",
    },
    danger: {
      ring: "border-red-500",
      pulse: "bg-red-500",
      text: "text-red-500",
    },
  };

  const selectedSize = sizeMap[size] || sizeMap.md;
  const selectedColor = colorMap[color] || colorMap.primary;

  // Default spinner loader
  if (type === "default") {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <div
          className={`relative ${selectedSize.container} flex items-center justify-center`}
        >
          {/* Outer rotating ring */}
          <div
            className={`absolute ${selectedSize.ring} border-4 ${selectedColor.ring} animate-spin rounded-full border-t-transparent`}
          ></div>

          {/* Inner pulsing circle */}
          <div
            className={`${selectedSize.inner} ${selectedColor.pulse} animate-pulse rounded-full opacity-30`}
          ></div>
        </div>

        {text && (
          <p
            className={`mt-4 font-medium ${selectedColor.text} ${selectedSize.text}`}
          >
            {text}
          </p>
        )}
      </div>
    );
  }

  // Redirect loader with progress indicator
  if (type === "redirect") {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center">
        <div className="relative w-64">
          {/* Progress text */}
          <div className="mb-2 text-center">
            <span className={`font-medium ${selectedColor.text}`}>
              {text || "Redirecting..."}
            </span>
          </div>

          {/* Progress bar container */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            {/* Progress bar fill */}
            <div
              className={`h-full ${selectedColor.pulse} rounded-full transition-all duration-300 ease-out`}
              style={{ width: `${progress}%` }}
            ></div>
          </div>

          {/* Progress percentage */}
          <div className="mt-1 text-right">
            <span className={`text-xs ${selectedColor.text}`}>{progress}%</span>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard content loader with skeleton
  if (type === "content") {
    return (
      <div className="flex w-full animate-pulse flex-col">
        {/* Header skeleton */}
        <div className="mb-6 flex w-full items-center justify-between">
          <div className="h-8 w-1/3 rounded bg-gray-200"></div>
          <div className="h-8 w-24 rounded bg-gray-200"></div>
        </div>

        {/* Content skeletons */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-lg bg-gray-100 p-4">
              <div className="mb-3 h-4 w-3/4 rounded bg-gray-200"></div>
              <div className="h-20 rounded bg-gray-200"></div>
              <div className="mt-3 h-4 w-1/2 rounded bg-gray-200"></div>
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="rounded-lg bg-gray-100 p-4">
          <div className="mb-3 h-4 w-1/4 rounded bg-gray-200"></div>
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="grid grid-cols-4 gap-4">
                <div className="col-span-1 h-4 rounded bg-gray-200"></div>
                <div className="col-span-2 h-4 rounded bg-gray-200"></div>
                <div className="col-span-1 h-4 rounded bg-gray-200"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default Loader;

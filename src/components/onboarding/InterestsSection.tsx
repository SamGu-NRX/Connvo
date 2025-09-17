// src/components/onboarding/InterestsSection.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "motion/react";
import {
  Plus,
  Code,
  Briefcase,
  Brain,
  Rocket,
  Palette,
  Book,
  Gamepad2,
  Dumbbell,
  Music,
  Camera,
  Plane,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/../convex/_generated/api";
import type { OnboardingFormData } from "@/schemas/onboarding";

// Load canonical interests catalog from Convex
const iconMap: Record<string, React.ComponentType<any>> = {
  Plus,
  Code,
  Briefcase,
  Brain,
  Rocket,
  Palette,

  Book,
  Gamepad2,
  Dumbbell,
  Music,
  Camera,
  Plane,
};

type InterestOption = {
  id: string;
  name: string;
  category: OnboardingFormData["interests"][number]["category"];
  iconName?: string;
};

function useInterestCatalog() {
  const catalog = useQuery(api.interests.queries.listCatalog, {});
  const byCategory = useMemo(() => {
    const map = new Map<string, Array<InterestOption>>();
    if (!catalog) return map;
    for (const i of catalog) {
      const arr = map.get(i.category) || [];
      arr.push({
        id: i.key,
        name: i.label,
        // Narrow category type using a runtime assertion — server enforces valid enums
        category: i.category as InterestOption["category"],
        iconName: i.iconName,
      });
      map.set(i.category, arr);
    }
    return map;
  }, [catalog]);
  const categories = useMemo(
    () => Array.from(byCategory.keys()).sort((a, b) => a.localeCompare(b)),
    [byCategory],
  );
  return { catalog, byCategory, categories };
}

interface InterestsSectionProps {
  onNext: () => void;
  onBack: () => void;
}

export default function InterestsSection({
  onNext,
  onBack,
}: InterestsSectionProps) {
  const {
    setValue,
    watch,
    trigger,
    formState: { errors },
  } = useFormContext<OnboardingFormData>();

  // We use a separate state for the custom interest input
  const [customInterest, setCustomInterest] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Get the current interests from the form
  const currentInterests = watch("interests");
  const { catalog, byCategory, categories } = useInterestCatalog();

  const filteredByCategory = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return byCategory;
    const map = new Map<string, Array<InterestOption>>();
    for (const [cat, list] of byCategory.entries()) {
      const filtered = list.filter((i) => i.name.toLowerCase().includes(term));
      if (filtered.length) map.set(cat, filtered);
    }
    return map;
  }, [byCategory, searchTerm]);

  const filteredCategories = useMemo(
    () =>
      Array.from(filteredByCategory.keys()).sort((a, b) => a.localeCompare(b)),
    [filteredByCategory],
  );

  // Toggle an interest: if already selected, remove it; otherwise, add it
  const handleToggleInterest = (interest: InterestOption) => {
    const index = currentInterests.findIndex((i) => i.id === interest.id);
    if (index !== -1) {
      const newInterests = [...currentInterests];
      newInterests.splice(index, 1);
      setValue("interests", newInterests, { shouldValidate: true });
    } else {
      const newInterest = {
        id: interest.id,
        name: interest.name,
        category: interest.category,
        iconName: interest.iconName || undefined,
      };
      setValue("interests", [...currentInterests, newInterest], {
        shouldValidate: true,
      });
    }
  };

  // Add a custom interest using the custom input
  const handleAddCustom = () => {
    if (customInterest.trim()) {
      const slug = customInterest
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const newInterest = {
        id: `custom:${slug}`,
        name: customInterest,
        category: "personal" as const,
        iconName: "Plus",
      };
      setValue("interests", [...currentInterests, newInterest], {
        shouldValidate: true,
      });
      setCustomInterest("");
    }
  };

  const handleNext = async () => {
    const isValid = await trigger("interests");
    if (isValid) {
      onNext();
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Your Interests</h2>
        <p className="text-muted-foreground">
          Select interests to help us match you with like-minded people
        </p>

        {/* Search Interests */}
        <div className="flex items-center gap-2">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search interests"
            className="flex-1"
          />
        </div>

        {/* Custom Interest Input */}
        <div className="flex space-x-2">
          <Input
            value={customInterest}
            onChange={(e) => setCustomInterest(e.target.value)}
            placeholder="Add a custom interest"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleAddCustom}
            disabled={!customInterest.trim()}
          >
            Add Custom
          </Button>
        </div>

        {/* Selected Interests */}
        {currentInterests.length > 0 && (
          <div className="space-y-2">
            <Label>Selected Interests</Label>
            <div className="flex flex-wrap gap-2">
              {currentInterests.map((interest) => (
                <motion.div
                  key={interest.id}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Badge
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => handleToggleInterest(interest)}
                  >
                    {interest.name} ×
                  </Badge>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Interests Catalog by Category */}
        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-6">
            {catalog === undefined && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-40" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-10 w-full" />
                  ))}
                </div>
              </div>
            )}
            {catalog !== undefined &&
              filteredCategories.map((category) => (
                <div key={category} className="space-y-2">
                  <Label>{category}</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {Array.from(filteredByCategory.get(category) || []).map(
                      (interest) => {
                        const isSelected = currentInterests.some(
                          (i) => i.id === interest.id,
                        );
                        const Icon = interest.iconName
                          ? iconMap[interest.iconName]
                          : undefined;
                        // Fallback icon by category if none provided
                        const FallbackIcon =
                          Icon ||
                          (category === "industry"
                            ? Briefcase
                            : category === "academic"
                              ? Book
                              : category === "skill"
                                ? Palette
                                : Rocket);
                        return (
                          <motion.button
                            key={interest.id}
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleToggleInterest(interest)}
                            className={`flex items-center space-x-2 rounded-md border p-2 transition-colors ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-secondary"
                            }`}
                          >
                            <FallbackIcon className="h-4 w-4" />
                            <span>{interest.name}</span>
                          </motion.button>
                        );
                      },
                    )}
                  </div>
                </div>
              ))}
            {catalog !== undefined && filteredCategories.length === 0 && (
              <div className="text-muted-foreground text-sm">No results.</div>
            )}
          </div>
        </ScrollArea>

        {/* Display form error from Zod validation */}
        {errors.interests && (
          <p className="text-destructive text-sm">{errors.interests.message}</p>
        )}
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={handleNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}

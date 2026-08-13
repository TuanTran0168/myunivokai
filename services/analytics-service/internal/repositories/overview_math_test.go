package repositories

import (
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// The arithmetic behind the dashboard's cards, tested without a database
// because none of it touches one. What a database IS needed for — that the
// funnel's four counts come from the same set of jobs, that the comparison's
// two periods do not overlap — is the SQL's own business and is asserted in
// the comments beside those queries, not here.

func TestADeltaWithoutABaselineReportsNoPercentageRatherThanInventingOne(t *testing.T) {
	// A platform deployed this morning has no yesterday. "+100%" against
	// nothing is a trend that never happened.
	fresh := newDelta(12, 0)
	if fresh.HasBaseline {
		t.Error("a previous value of zero was treated as a baseline")
	}
	if fresh.ChangePercent != 0 {
		t.Errorf("changePercent = %v, want 0 when there is nothing to compare against", fresh.ChangePercent)
	}
	if fresh.Current != 12 || fresh.Previous != 0 {
		t.Errorf("the absolute values did not survive: %+v", fresh)
	}

	// Both sides zero is still no baseline — a quiet day against a quiet day
	// has nothing to say, and 0% would read as "unchanged", which claims more.
	if newDelta(0, 0).HasBaseline {
		t.Error("two empty periods were treated as a comparison")
	}
}

func TestADeltaRoundsToTwoPlacesAndKeepsItsSign(t *testing.T) {
	cases := []struct {
		name     string
		current  int
		previous int
		want     float64
	}{
		{"growth", 30, 20, 50},
		{"decline", 20, 30, -33.33},
		{"unchanged", 20, 20, 0},
		{"collapse to nothing", 0, 8, -100},
		{"one third", 4, 3, 33.33},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			delta := newDelta(testCase.current, testCase.previous)
			if delta.ChangePercent != testCase.want {
				t.Errorf("changePercent = %v, want %v", delta.ChangePercent, testCase.want)
			}
			if !delta.HasBaseline {
				t.Error("a non-zero previous value must count as a baseline")
			}
		})
	}
}

func TestTheFunnelMeasuresEveryStageAgainstTheEntryStage(t *testing.T) {
	funnel := generationFunnel(200, 180, 175, 40)
	if len(funnel) != 4 {
		t.Fatalf("funnel has %d stages, want 4", len(funnel))
	}

	expectedStages := []string{
		contracts.AnalyticsFunnelStageSubmitted,
		contracts.AnalyticsFunnelStageCompleted,
		contracts.AnalyticsFunnelStageProjected,
		contracts.AnalyticsFunnelStagePublished,
	}
	for index, expected := range expectedStages {
		if funnel[index].Stage != expected {
			t.Errorf("stage %d = %q, want %q", index, funnel[index].Stage, expected)
		}
		if funnel[index].Label == "" {
			t.Errorf("stage %q carries no label for a chart to print", expected)
		}
	}

	// Against the ENTRY, not the previous stage. 40 of 200 is 20%; 40 of the
	// 175 before it would be 22.86%, which reads as a healthier funnel than
	// the one that happened.
	if funnel[3].PercentOfEntry != 20 {
		t.Errorf("published = %v%% of entry, want 20", funnel[3].PercentOfEntry)
	}
	if funnel[0].PercentOfEntry != 100 {
		t.Errorf("the entry stage is %v%% of itself, want 100", funnel[0].PercentOfEntry)
	}

	// A funnel over an empty window must not divide by its own entry count.
	for _, stage := range generationFunnel(0, 0, 0, 0) {
		if stage.PercentOfEntry != 0 {
			t.Errorf("stage %q reported %v%% of an empty window", stage.Stage, stage.PercentOfEntry)
		}
	}
}

func TestThePeakHourIsAbsentRatherThanMidnightWhenNothingWasSubmitted(t *testing.T) {
	if peak := peakHour(nil); peak != nil {
		t.Errorf("peak hour = %+v, want absent", peak)
	}
	// Hours are returned only when they saw a job, but a zero row arriving
	// from anywhere must not win the maximum by default.
	if peak := peakHour([]contracts.AnalyticsHourBucket{{Hour: 0, JobCount: 0}}); peak != nil {
		t.Errorf("peak hour = %+v, want absent", peak)
	}

	peak := peakHour([]contracts.AnalyticsHourBucket{
		{Hour: 3, JobCount: 4},
		{Hour: 14, JobCount: 31},
		{Hour: 22, JobCount: 30},
	})
	if peak == nil {
		t.Fatal("peak hour is absent from a window that saw jobs")
	}
	if peak.Hour != 14 || peak.JobCount != 31 {
		t.Errorf("peak hour = %+v, want hour 14 with 31 jobs", *peak)
	}
}

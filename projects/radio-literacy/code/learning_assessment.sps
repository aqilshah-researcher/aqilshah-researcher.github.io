* =====================================================================
* Radio-based literacy programme: the same checks in SPSS syntax
* Author : Aqil Shah Ayaz
* Data   : SAFE SAMPLE DATA (simulated)
* =====================================================================.

GET DATA /TYPE=TXT
  /FILE='../data/learner_assessment.csv'
  /DELIMITERS=","
  /FIRSTCASE=2
  /ARRANGEMENT=DELIMITED
  /VARIABLES=
    learner_id A8 province A12 sex A8 learner_group A25 age F3.0 weeks_enrolled F3.0
    read_letter F1.0 read_word F1.0 read_sentence F1.0 read_short_text F1.0
    write_letter F1.0 write_word F1.0 write_sentence F1.0
    count_objects F1.0 add_numbers F1.0 subtract_numbers F1.0 tell_time F1.0 read_price F1.0
    self_rated_improvement A12 radio_signal_stable F1.0 difficulty_accessing_radio F1.0
    sound_quality_issue F1.0 needs_trainer F1.0 lesson_length_ok F1.0 confident_method_sustainable F1.0.
EXECUTE.

* Test reliability (KR-20 = Cronbach alpha on 0/1 items) and item-total statistics.
RELIABILITY
  /VARIABLES=read_letter TO read_price
  /SCALE('Literacy and numeracy test') ALL
  /MODEL=ALPHA
  /STATISTICS=DESCRIPTIVE
  /SUMMARY=TOTAL.

* Domain scores (percent correct).
COMPUTE reading_pct  = 100 * MEAN(read_letter, read_word, read_sentence, read_short_text).
COMPUTE writing_pct  = 100 * MEAN(write_letter, write_word, write_sentence).
COMPUTE numeracy_pct = 100 * MEAN(count_objects, add_numbers, subtract_numbers, tell_time, read_price).
EXECUTE.

MEANS TABLES=reading_pct writing_pct numeracy_pct BY province BY sex
  /CELLS=MEAN COUNT STDDEV.

* Does self-rated improvement differ by province?
CROSSTABS /TABLES=province BY self_rated_improvement
  /STATISTICS=CHISQ
  /CELLS=COUNT ROW.

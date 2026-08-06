import React, { useState, useEffect, useRef } from 'react';
import { Heartbeat, ArrowsClockwise, CaretRight, WarningCircle } from '@phosphor-icons/react';
import axios from 'axios';
import api from '../../../api/axios';
import { gsap } from 'gsap';

interface HealthResult {
  basic_info?: {
    height?: number | string;
    height_desc?: string;
    weight?: number | string;
    weight_desc?: string;
    gender?: string;
    gender_desc?: string;
    age?: number | string;
    age_desc?: string;
  };
  bmi?: {
    value?: string | number;
    value_desc?: string;
    category?: string;
    category_desc?: string;
    evaluation?: string;
    evaluation_desc?: string;
    risk?: string;
    risk_desc?: string;
  };
  weight_assessment?: {
    ideal_weight_range?: string;
    ideal_weight_range_desc?: string;
    standard_weight?: string;
    standard_weight_desc?: string;
    status?: string;
    status_desc?: string;
    adjustment?: string;
    adjustment_desc?: string;
  };
  metabolism?: {
    bmr?: string | number;
    bmr_desc?: string;
    tdee?: string | number;
    tdee_desc?: string;
    recommended_calories?: string | number;
    recommended_calories_desc?: string;
    weight_loss_calories?: string | number;
    weight_loss_calories_desc?: string;
    weight_gain_calories?: string | number;
    weight_gain_calories_desc?: string;
  };
  body_surface_area?: {
    value?: string | number;
    value_desc?: string;
    formula?: string;
  };
  body_fat?: {
    percentage?: string | number;
    percentage_desc?: string;
    category?: string;
    category_desc?: string;
    fat_weight?: string;
    fat_weight_desc?: string;
    lean_weight?: string;
    lean_weight_desc?: string;
  };
  health_advice?: {
    daily_water_intake?: string;
    daily_water_intake_desc?: string;
    exercise_recommendation?: string;
    nutrition_advice?: string;
    health_tips?: string[];
  };
  ideal_measurements?: Record<string, unknown>;
  disclaimer?: string;
}

const HealthTool: React.FC = () => {
  const [height, setHeight] = useState('175');
  const [weight, setWeight] = useState('70');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState('25');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<HealthResult | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from('.gsap-reveal', {
        y: 16,
        opacity: 0,
        duration: 0.65,
        stagger: 0.08,
        ease: 'expo.out',
        delay: 0.12,
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const handleCalculate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');

    const numHeight = Number(height);
    const numWeight = Number(weight);
    const numAge = Number(age);

    if (!numHeight || numHeight <= 0) {
      setError('请输入有效的身高 (cm)');
      return;
    }
    if (!numWeight || numWeight <= 0) {
      setError('请输入有效的体重 (kg)');
      return;
    }
    if (!numAge || numAge <= 0) {
      setError('请输入有效的年龄');
      return;
    }

    setLoading(true);

    try {
      const res = await api.post<{ result: HealthResult }>('/tools/health/calculate', {
        height: numHeight,
        weight: numWeight,
        gender,
        age: numAge,
      });

      setResult(res.data.result);

      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTimeout(() => {
          gsap.fromTo(
            '.result-box',
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }
          );
        }, 50);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || '系统发生错误');
      } else {
        setError('系统发生错误');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 flex-col pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
        {/* 左侧控制区 */}
        <div className="gsap-reveal lg:col-span-5 flex flex-col gap-10 self-start lg:sticky lg:top-28">
          <div className="flex flex-col gap-2 border-b border-border pb-4">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
              [ INPUT PARAMETERS / 身体参数 ]
            </span>
            <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
              健康数据计算
            </h2>
          </div>

          <form onSubmit={handleCalculate} className="flex flex-col gap-8">
            {/* 性别选择 */}
            <div className="flex flex-col gap-3">
              <label className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                生理性别 (GENDER)
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setGender('male')}
                  className={`flex h-12 items-center justify-center border font-mono text-sm tracking-wider uppercase transition-all ${
                    gender === 'male'
                      ? 'border-primary bg-primary text-primary-foreground font-bold'
                      : 'border-border bg-transparent text-muted-foreground hover:border-foreground hover:text-foreground'
                  }`}
                >
                  男 (MALE)
                </button>
                <button
                  type="button"
                  onClick={() => setGender('female')}
                  className={`flex h-12 items-center justify-center border font-mono text-sm tracking-wider uppercase transition-all ${
                    gender === 'female'
                      ? 'border-primary bg-primary text-primary-foreground font-bold'
                      : 'border-border bg-transparent text-muted-foreground hover:border-foreground hover:text-foreground'
                  }`}
                >
                  女 (FEMALE)
                </button>
              </div>
            </div>

            {/* 身高 */}
            <div className="relative group">
              <input
                type="number"
                step="0.1"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="awwwards-input w-full font-mono text-xl text-foreground selection:bg-primary selection:text-primary-foreground"
                placeholder=" "
                id="height-input"
              />
              <label
                htmlFor="height-input"
                className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8"
              >
                身高 / HEIGHT (CM)
              </label>
            </div>

            {/* 体重 */}
            <div className="relative group">
              <input
                type="number"
                step="0.1"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="awwwards-input w-full font-mono text-xl text-foreground selection:bg-primary selection:text-primary-foreground"
                placeholder=" "
                id="weight-input"
              />
              <label
                htmlFor="weight-input"
                className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8"
              >
                体重 / WEIGHT (KG)
              </label>
            </div>

            {/* 年龄 */}
            <div className="relative group">
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="awwwards-input w-full font-mono text-xl text-foreground selection:bg-primary selection:text-primary-foreground"
                placeholder=" "
                id="age-input"
              />
              <label
                htmlFor="age-input"
                className="pointer-events-none absolute left-0 top-4 font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground transition-[color,transform] duration-300 group-focus-within:-translate-y-8 group-focus-within:text-primary [.awwwards-input:not(:placeholder-shown)~&]:-translate-y-8"
              >
                年龄 / AGE (YEARS)
              </label>
            </div>

            {error && (
              <div role="alert" className="flex items-center gap-2 font-mono text-xs text-destructive">
                <WarningCircle className="h-4 w-4 shrink-0" />
                <span>[ 异常: {error} ]</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-14 w-full items-center justify-center gap-3 border border-primary bg-primary font-mono text-sm font-bold uppercase tracking-widest text-primary-foreground transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <ArrowsClockwise className="h-5 w-5 animate-spin" />
                  <span>计算中...</span>
                </>
              ) : (
                <>
                  <Heartbeat className="h-5 w-5" />
                  <span>开始计算</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* 右侧结果区 */}
        <div className="gsap-reveal lg:col-span-7 flex flex-col gap-10">
          {!result ? (
            <div className="flex h-96 w-full flex-col items-center justify-center border border-dashed border-border p-8 text-center">
              <Heartbeat className="mb-4 h-12 w-12 text-muted-foreground opacity-40" />
              <p className="font-mono text-sm text-muted-foreground">
                [ 暂无数据 · 请填写左侧参数并点击计算 ]
              </p>
            </div>
          ) : (
            <div className="result-box flex flex-col gap-10">
              {/* BMI 头部凸显 */}
              <div className="flex flex-col gap-4 border-b border-border pb-8">
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                  [ BMI ASSESSMENT / 身体质量指数 ]
                </span>
                <div className="flex flex-wrap items-baseline gap-6">
                  <span className="font-mono text-6xl md:text-7xl font-bold tracking-tighter text-foreground">
                    {result.bmi?.value || '--'}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="border border-primary bg-primary/10 px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest text-primary">
                      {result.bmi?.category_desc || result.bmi?.category || '普通'}
                    </span>
                    {(result.bmi?.risk_desc || result.bmi?.risk) && (
                      <span className="border border-border bg-muted px-3 py-1 font-mono text-xs tracking-wider text-muted-foreground">
                        {result.bmi?.risk_desc || result.bmi?.risk}
                      </span>
                    )}
                  </div>
                </div>
                {(result.bmi?.evaluation_desc || result.bmi?.evaluation) && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {result.bmi?.evaluation_desc || result.bmi?.evaluation}
                  </p>
                )}
              </div>

              {/* 体重评估 */}
              {result.weight_assessment && (
                <div className="flex flex-col gap-4">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                    [ WEIGHT ASSESSMENT / 体重分析 ]
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">理想体重范围</span>
                      <span className="font-mono text-lg font-bold text-foreground">
                        {result.weight_assessment.ideal_weight_range_desc ||
                          result.weight_assessment.ideal_weight_range ||
                          '--'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">标准体重</span>
                      <span className="font-mono text-lg font-bold text-foreground">
                        {result.weight_assessment.standard_weight_desc ||
                          result.weight_assessment.standard_weight ||
                          '--'}
                      </span>
                    </div>
                    {(result.weight_assessment.status_desc || result.weight_assessment.status) && (
                      <div className="flex flex-col gap-1 md:col-span-2">
                        <span className="font-mono text-xs text-muted-foreground">状态与建议</span>
                        <span className="text-sm text-foreground">
                          {result.weight_assessment.status_desc || result.weight_assessment.status}
                          {result.weight_assessment.adjustment_desc || result.weight_assessment.adjustment
                            ? ` (${result.weight_assessment.adjustment_desc || result.weight_assessment.adjustment})`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 代谢网格 (Metabolism Grid) */}
              {result.metabolism && (
                <div className="flex flex-col gap-4">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                    [ METABOLISM & CALORIES / 代谢与卡路里 ]
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 border-t border-border pt-6">
                    <div className="flex flex-col gap-1 border-b sm:border-b-0 border-border pb-4 sm:pb-0">
                      <span className="font-mono text-xs text-muted-foreground">基础代谢 (BMR)</span>
                      <span className="font-mono text-xl font-bold text-foreground">
                        {result.metabolism.bmr_desc || (result.metabolism.bmr ? `${result.metabolism.bmr} kcal` : '--')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 border-b sm:border-b-0 border-border pb-4 sm:pb-0">
                      <span className="font-mono text-xs text-muted-foreground">每日总消耗 (TDEE)</span>
                      <span className="font-mono text-xl font-bold text-foreground">
                        {result.metabolism.tdee_desc || (result.metabolism.tdee ? `${result.metabolism.tdee} kcal` : '--')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 border-b sm:border-b-0 border-border pb-4 sm:pb-0">
                      <span className="font-mono text-xs text-muted-foreground">推荐摄入</span>
                      <span className="font-mono text-xl font-bold text-primary">
                        {result.metabolism.recommended_calories_desc || (result.metabolism.recommended_calories ? `${result.metabolism.recommended_calories} kcal` : '--')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">减脂建议摄入</span>
                      <span className="font-mono text-lg text-foreground">
                        {result.metabolism.weight_loss_calories_desc || (result.metabolism.weight_loss_calories ? `${result.metabolism.weight_loss_calories} kcal` : '--')}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-muted-foreground">增肌建议摄入</span>
                      <span className="font-mono text-lg text-foreground">
                        {result.metabolism.weight_gain_calories_desc || (result.metabolism.weight_gain_calories ? `${result.metabolism.weight_gain_calories} kcal` : '--')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 体脂与水分 */}
              {(result.body_fat || result.health_advice?.daily_water_intake) && (
                <div className="flex flex-col gap-4">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                    [ COMPOSITION & WATER / 体成分与饮水 ]
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 border-t border-border pt-4">
                    {result.body_fat && (
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-xs text-muted-foreground">预估体脂率</span>
                        <span className="font-mono text-lg font-bold text-foreground">
                          {result.body_fat.percentage_desc || result.body_fat.percentage || '--'}
                        </span>
                      </div>
                    )}
                    {result.health_advice?.daily_water_intake && (
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-xs text-muted-foreground">建议每日饮水量</span>
                        <span className="font-mono text-lg font-bold text-foreground">
                          {result.health_advice.daily_water_intake_desc || result.health_advice.daily_water_intake}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 健康建议 */}
              {result.health_advice?.health_tips && Array.isArray(result.health_advice.health_tips) && result.health_advice.health_tips.length > 0 && (
                <div className="flex flex-col gap-4">
                  <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">
                    [ HEALTH TIPS / 健康建议 ]
                  </span>
                  <ul className="flex flex-col gap-2 border-t border-border pt-4">
                    {result.health_advice.health_tips.map((tip) => (
                      <li key={tip} className="flex items-start gap-3 text-sm text-foreground leading-relaxed">
                        <CaretRight className="mt-1 h-4 w-4 shrink-0 text-primary" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 免责声明 */}
              {result.disclaimer && (
                <div className="border-t border-border pt-4">
                  <p className="font-mono text-xs text-muted-foreground leading-relaxed">
                    * {result.disclaimer}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HealthTool;

"""健康评估服务。

完整对齐 60s 项目 src/modules/health.module.ts 的响应 JSON 结构：
basic_info / bmi / weight_assessment / metabolism / body_surface_area /
body_fat / health_advice / ideal_measurements / disclaimer，
字段名与文案逐一保持一致（公式同源：BMI、Harris-Benedict BMR、
Du Bois 体表面积、简化体脂率估算等）。
"""

DISCLAIMER = "结果基于通用公式和统计数据，仅供参考，不能替代专业医疗建议。如有健康问题，请咨询医生。"


def get_bmi_category(bmi: float) -> dict:
    """BMI 分类（对齐 60s getBMICategory）。"""
    if bmi < 18.5:
        return {
            "category": "体重过轻",
            "evaluation": "体重不足，需要适当增重",
            "risk": "营养不良风险",
        }
    if bmi < 24:
        return {
            "category": "正常体重",
            "evaluation": "体重正常，保持良好",
            "risk": "健康风险较低",
        }
    if bmi < 28:
        return {
            "category": "超重",
            "evaluation": "体重超重，建议减重",
            "risk": "慢性病风险增加",
        }
    return {
        "category": "肥胖",
        "evaluation": "肥胖状态，需要积极减重",
        "risk": "高血压、糖尿病等疾病风险显著增加",
    }


def get_ideal_weight(height: float) -> dict:
    """WHO 推荐的理想 BMI 范围 18.5-24。"""
    height_in_m = height / 100
    min_weight = round(18.5 * height_in_m * height_in_m * 10) / 10
    max_weight = round(24 * height_in_m * height_in_m * 10) / 10
    return {"min": min_weight, "max": max_weight}


def get_standard_weight(height: float) -> float:
    """标准体重公式：身高(cm) - 105。"""
    return round((height - 105) * 10) / 10


def calculate_bmr(weight: float, height: float, age: int, gender: str) -> float:
    """Harris-Benedict 基础代谢率公式。"""
    if gender == "male":
        return 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
    return 447.593 + 9.247 * weight + 3.098 * height - 4.33 * age


def calculate_bsa(weight: float, height: float) -> float:
    """Du Bois 体表面积公式。"""
    bsa = 0.007184 * pow(weight, 0.425) * pow(height, 0.725)
    return round(bsa * 100) / 100


def estimate_body_fat(bmi: float, age: int, gender: str, weight: float) -> dict:
    """简化体脂率估算（对齐 60s estimateBodyFat）。"""
    if gender == "male":
        body_fat_percentage = 1.2 * bmi + 0.23 * age - 16.2
    else:
        body_fat_percentage = 1.2 * bmi + 0.23 * age - 5.4

    body_fat_percentage = max(3, min(50, body_fat_percentage))
    percentage = round(body_fat_percentage * 10) / 10

    fat_weight = round((percentage / 100) * weight * 10) / 10
    lean_weight = round((weight - fat_weight) * 10) / 10

    if gender == "male":
        if percentage < 10:
            category = "极低"
        elif percentage < 15:
            category = "正常"
        elif percentage < 20:
            category = "略高"
        else:
            category = "过高"
    else:
        if percentage < 16:
            category = "极低"
        elif percentage < 24:
            category = "正常"
        elif percentage < 30:
            category = "略高"
        else:
            category = "过高"

    return {
        "percentage": str(percentage),
        "category": category,
        "fatWeight": str(fat_weight),
        "leanWeight": str(lean_weight),
    }


def get_weight_status(weight: float, ideal_weight: dict) -> str:
    if weight < ideal_weight["min"]:
        return "体重偏轻"
    if weight > ideal_weight["max"]:
        return "体重偏重"
    return "体重正常"


def get_weight_adjustment(weight: float, ideal_weight: dict) -> str:
    if weight < ideal_weight["min"]:
        diff = ideal_weight["min"] - weight
        return f"建议增重 {diff:.1f}kg"
    if weight > ideal_weight["max"]:
        diff = weight - ideal_weight["max"]
        return f"建议减重 {diff:.1f}kg"
    return "保持当前体重"


def get_water_intake(weight: float, age: int, gender: str) -> str:
    """基础需水量：每公斤体重 30-35ml，含年龄/性别调整（对齐 60s）。"""
    base_intake = weight * 32

    if age >= 65:
        base_intake *= 0.9
    elif age >= 50:
        base_intake *= 0.95
    elif age <= 25:
        base_intake *= 1.05

    if gender == "male":
        base_intake *= 1.05

    intake = round(base_intake / 250) * 250
    cups = round(intake / 250)

    tips = f"{intake}ml (约 {cups} 杯水)"

    if age >= 65:
        tips += "，老年人应少量多次，避免一次性大量饮水"
    elif age <= 30:
        tips += "，运动时需额外补充 500-1000ml"

    return tips


def get_exercise_advice(bmi: float, age: int, gender: str) -> str:
    """运动建议（对齐 60s getExerciseAdvice）。"""
    if bmi < 18.5:
        base_advice = "适度的力量训练有助于增强体质"
    elif bmi < 24:
        base_advice = "继续保持运动习惯，有氧运动和力量训练相结合效果更佳"
    elif bmi < 28:
        base_advice = "适当增加运动量，有氧运动有助于体重管理"
    else:
        base_advice = "可以从轻度运动开始，如散步、游泳等低冲击运动"

    if age <= 30:
        age_advice = "年轻人可选择多样化的运动方式，建议每周运动 3-5 次"
    elif age <= 50:
        age_advice = "成年人推荐每周 150 分钟中等强度运动，如快走、游泳、骑车等"
    elif age <= 65:
        age_advice = "中年人适合低冲击运动，注意运动前的热身和运动后的放松"
    else:
        age_advice = "老年人以维持日常活动能力为主，可选择太极、散步等温和运动"

    gender_tip = ""
    if gender == "male" and age >= 40:
        gender_tip = "，注意心血管健康"
    elif gender == "female" and age >= 45:
        gender_tip = "，适度的负重运动有益骨骼健康"

    return f"{base_advice}。{age_advice}{gender_tip}"


def get_nutrition_advice(bmi_category: str, gender: str, age: int) -> str:
    """营养建议（对齐 60s getNutritionAdvice）。"""
    special_tips: list[str] = []

    if bmi_category == "体重过轻":
        base_advice = "建议增加优质蛋白质摄入，如鱼、蛋、奶制品，可适当增加餐次"
    elif bmi_category == "正常体重":
        base_advice = "保持均衡饮食，三大营养素合理搭配，定时定量进餐"
    elif bmi_category == "超重":
        base_advice = "适当控制总热量，多吃蔬菜水果，减少高糖高脂食物"
    elif bmi_category == "肥胖":
        base_advice = "控制热量摄入，选择营养密度高的食物，可考虑咨询营养专家"
    else:
        base_advice = "均衡营养，规律饮食"

    if age <= 30:
        special_tips.append("年轻人新陈代谢较快，可适当增加能量摄入")
    elif age <= 50:
        special_tips.append("成年人注重抗氧化营养素，多吃深色蔬菜和水果")
    else:
        special_tips.append("中老年人适当补充钙质和维生素 D，选择易消化的食物")

    if gender == "male":
        special_tips.append("男性可适当增加蛋白质摄入")
    else:
        if 20 <= age <= 50:
            special_tips.append("女性注意铁质和叶酸的补充")
        if age >= 45:
            special_tips.append("更年期女性可适量增加豆制品摄入")

    tips = f"。{'，'.join(special_tips)}" if special_tips else ""
    return f"{base_advice}{tips}"


def get_health_tips(bmi: float, age: int, gender: str) -> list[str]:
    """健康提示列表（对齐 60s getHealthTips）。"""
    tips: list[str] = []

    tips.append("保持充足睡眠，成年人建议每天 7-9 小时")
    tips.append("定期体检有助于早期发现健康问题")
    tips.append("保持良好心态，适当释放压力")

    if bmi < 18.5:
        tips.append("体重偏轻时注意营养均衡，避免过度疲劳")
    elif bmi >= 24:
        tips.append("控制饮食量，养成细嚼慢咽的习惯")
        tips.append("减少久坐时间，适当增加日常活动")

    if age <= 30:
        tips.append("年轻人要注意作息规律，合理安排工作与休息")
        tips.append("长时间用眼后适当休息，保护视力")
    elif age <= 50:
        tips.append("中年人关注心血管健康，适当运动")
        tips.append("注意钙质补充，预防骨质疏松")
    else:
        tips.append("老年人注意居家安全，预防跌倒")
        tips.append("保持社交活动，维护心理健康")

    if gender == "female":
        if age >= 45:
            tips.append("更年期女性可关注骨骼健康")
        elif 20 <= age <= 40:
            tips.append("育龄期女性注意营养摄入的均衡性")
    else:
        if age >= 40:
            tips.append("中年男性适当关注前列腺健康")
            tips.append("戒烟限酒有益心血管健康")

    tips.append("培养兴趣爱好，保持积极的生活态度")
    tips.append("多饮水，成年人每天 1500-2000ml 为宜")

    return tips


def get_ideal_measurements(height: float, gender: str) -> dict:
    """基于身高的理想三围计算（对齐 60s getIdealMeasurements）。"""
    if gender == "male":
        chest = round(height * 0.48)
        waist = round(height * 0.42)
        hip = round(height * 0.47)
        note = "男性理想三围参考标准"
    else:
        chest = round(height * 0.51)
        waist = round(height * 0.37)
        hip = round(height * 0.53)
        note = "女性理想三围参考标准"

    return {
        "chest": f"{chest}cm",
        "waist": f"{waist}cm",
        "hip": f"{hip}cm",
        "note": note,
    }


def calculate_health(height: float, weight: float, gender: str, age: int) -> dict:
    """计算完整健康评估结果（对齐 60s calculateHealth 的响应结构）。"""
    height_in_m = height / 100

    bmi = weight / (height_in_m * height_in_m)
    bmi_category = get_bmi_category(bmi)

    ideal_weight = get_ideal_weight(height)
    standard_weight = get_standard_weight(height)

    bmr = calculate_bmr(weight, height, age, gender)
    tdee = bmr * 1.6  # 轻度活动系数

    bsa = calculate_bsa(weight, height)

    body_fat = estimate_body_fat(bmi, age, gender, weight)

    measurements = get_ideal_measurements(height, gender)

    return {
        "basic_info": {
            "height": f"{height:g}cm",
            "height_desc": "身高",
            "weight": f"{weight:g}kg",
            "weight_desc": "体重",
            "gender": "男性" if gender == "male" else "女性",
            "gender_desc": "性别",
            "age": f"{age}岁",
            "age_desc": "年龄",
        },
        "bmi": {
            "value": round(bmi * 100) / 100,
            "value_desc": "BMI 值",
            "category": bmi_category["category"],
            "category_desc": "BMI 分类",
            "evaluation": bmi_category["evaluation"],
            "evaluation_desc": "BMI 评价",
            "risk": bmi_category["risk"],
            "risk_desc": "健康风险",
        },
        "weight_assessment": {
            "ideal_weight_range": f"{ideal_weight['min']}-{ideal_weight['max']}kg",
            "ideal_weight_range_desc": "理想体重范围",
            "standard_weight": f"{standard_weight}kg",
            "standard_weight_desc": "标准体重",
            "status": get_weight_status(weight, ideal_weight),
            "status_desc": "体重状态",
            "adjustment": get_weight_adjustment(weight, ideal_weight),
            "adjustment_desc": "调整建议",
        },
        "metabolism": {
            "bmr": f"{round(bmr)} 卡路里/天",
            "bmr_desc": "基础代谢率",
            "tdee": f"{round(tdee)} 卡路里/天",
            "tdee_desc": "每日总消耗",
            "recommended_calories": f"{round(tdee)} 卡路里/天",
            "recommended_calories_desc": "推荐卡路里摄入",
            "weight_loss_calories": f"{round(tdee - 500)} 卡路里/天",
            "weight_loss_calories_desc": "减重卡路里",
            "weight_gain_calories": f"{round(tdee + 300)} 卡路里/天",
            "weight_gain_calories_desc": "增重卡路里",
        },
        "body_surface_area": {
            "value": f"{bsa}m²",
            "value_desc": "体表面积",
            "formula": "Du Bois 公式",
            "formula_desc": "计算公式",
        },
        "body_fat": {
            "percentage": f"{body_fat['percentage']}%",
            "percentage_desc": "体脂率",
            "category": body_fat["category"],
            "category_desc": "体脂分类",
            "fat_weight": f"{body_fat['fatWeight']}kg",
            "fat_weight_desc": "脂肪重量",
            "lean_weight": f"{body_fat['leanWeight']}kg",
            "lean_weight_desc": "瘦体重",
        },
        "health_advice": {
            "daily_water_intake": get_water_intake(weight, age, gender),
            "daily_water_intake_desc": "每日饮水量",
            "exercise_recommendation": get_exercise_advice(bmi, age, gender),
            "exercise_recommendation_desc": "运动建议",
            "nutrition_advice": get_nutrition_advice(
                bmi_category["category"], gender, age
            ),
            "nutrition_advice_desc": "营养建议",
            "health_tips": get_health_tips(bmi, age, gender),
            "health_tips_desc": "健康提示",
        },
        "ideal_measurements": {
            "chest": measurements["chest"],
            "chest_desc": "胸围",
            "waist": measurements["waist"],
            "waist_desc": "腰围",
            "hip": measurements["hip"],
            "hip_desc": "臀围",
            "note": measurements["note"],
            "note_desc": "说明",
        },
        "disclaimer": DISCLAIMER,
    }

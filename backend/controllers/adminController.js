import Donor from "../models/donorModel.js";
import Facility from "../models/facilityModel.js";
import Blood from "../models/bloodModel.js";
import BloodRequest from "../models/bloodRequestModel.js";

// 🧩 Get Dashboard Overview Stats
export const getDashboardStats = async (req, res) => {
  try {
    const totalDonors = await Donor.countDocuments();
    const totalFacilities = await Facility.countDocuments();
    const pendingFacilities = await Facility.countDocuments({ status: "pending" });
    const approvedFacilities = await Facility.countDocuments({ status: "approved" });

    // Count total donations across all donors
    const donors = await Donor.find({}, "donationHistory");
    const totalDonations = donors.reduce(
      (sum, donor) => sum + (donor.donationHistory?.length || 0),
      0
    );

    const activeDonors = await Donor.countDocuments({ isEligible: true });

    res.status(200).json({
      totalDonors,
      totalFacilities,
      approvedFacilities,
      pendingFacilities,
      totalDonations,
      activeDonors,
      upcomingCamps: 3, // Placeholder
    });
  } catch (err) {
    console.error("Admin Stats Error:", err);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
};

// 🧍 Get All Donors
export const getAllDonors = async (req, res) => {
  try {
    // Note: This function was present in your code block but not used in the router
    const donors = await Donor.find().select("-password");
    res.status(200).json({ donors });
  } catch (err) {
    res.status(500).json({ message: "Error fetching donors" });
  }
};

// 🏥 Get All Facilities (Pending + Approved)
export const getAllFacilities = async (req, res) => {
  try {
    const facilities = await Facility.find();
    res.status(200).json({ facilities });
  } catch (err) {
    res.status(500).json({ message: "Error fetching facilities" });
  }
};

// ✅ Approve a Facility
export const approveFacility = async (req, res) => {
  try {
    const facility = await Facility.findById(req.params.id);
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    facility.status = "approved";

    // HISTORY LOGIC DELETED

    await facility.save();

    res.status(200).json({ message: "Facility approved", facility });
  } catch (err) {
    console.error("Facility Approval Error:", err);
    res.status(500).json({ message: "Error approving facility" });
  }
};

// ❌ Reject / Update Facility Status to Rejected
export const rejectFacility = async (req, res) => {
  try {
    const facility = await Facility.findById(req.params.id);
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    const { rejectionReason } = req.body;
    if (!rejectionReason) return res.status(400).json({ message: "Rejection reason is required." });

    facility.status = "rejected";
    facility.rejectionReason = rejectionReason;

    // HISTORY LOGIC DELETED

    await facility.save();

    res.status(200).json({ message: "Facility rejected and status updated", facility });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error rejecting facility" });
  }
};

export const getBloodPrediction = async (req, res) => {
  try {
    const bloodGroups = [
      "A+",
      "A-",
      "B+",
      "B-",
      "O+",
      "O-",
      "AB+",
      "AB-",
    ];

    const now = new Date();

    // Analyze requests from the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // Get recent blood requests
    const requests = await BloodRequest.find({
      createdAt: { $gte: thirtyDaysAgo },
      status: { $in: ["pending", "accepted"] },
    });

    // Get currently available blood-lab stock
    const stock = await Blood.find({
      bloodLab: { $exists: true, $ne: null },
      expiryDate: { $gt: now },
    });

    const predictions = bloodGroups.map((bloodGroup) => {
      // -----------------------------
      // CURRENT STOCK
      // -----------------------------
      const currentStock = stock
        .filter((item) => item.bloodGroup === bloodGroup)
        .reduce((sum, item) => sum + item.quantity, 0);

      // -----------------------------
      // REQUEST HISTORY
      // -----------------------------
      const groupRequests = requests.filter(
        (request) => request.bloodType === bloodGroup
      );

      const totalDemand = groupRequests.reduce(
        (sum, request) => sum + request.units,
        0
      );

      const pendingDemand = groupRequests
        .filter((request) => request.status === "pending")
        .reduce((sum, request) => sum + request.units, 0);

      const acceptedDemand = groupRequests
        .filter((request) => request.status === "accepted")
        .reduce((sum, request) => sum + request.units, 0);

      // -----------------------------------------
      // NOT ENOUGH DATA
      // -----------------------------------------
      if (groupRequests.length < 3) {
        return {
          bloodGroup,
          currentStock,
          predictedDemand: null,
          shortage: null,
          risk: "INSUFFICIENT_DATA",
          confidence: "LOW",
          recentRequests: groupRequests.length,
        };
      }

      // -----------------------------------------
      // SIMPLE DEMAND FORECAST
      // -----------------------------------------

      // 30-day demand converted to weekly demand
      const weeklyDemand = totalDemand / 4.285;

      // Slight growth factor for near-future demand
      const predictedDemand = Math.max(
        1,
        Math.ceil(
          weeklyDemand * 1.15 +
            pendingDemand * 0.35 +
            acceptedDemand * 0.15
        )
      );

      // Calculate shortage
      const shortage = Math.max(
        0,
        predictedDemand - currentStock
      );

      // -----------------------------------------
      // RISK CALCULATION
      // -----------------------------------------

      let risk = "LOW";

      if (currentStock === 0) {
        risk = "CRITICAL";
      } else if (shortage >= predictedDemand * 0.5) {
        risk = "HIGH";
      } else if (shortage > 0) {
        risk = "MEDIUM";
      }

      // -----------------------------------------
      // CONFIDENCE
      // -----------------------------------------

      let confidence = "LOW";

      if (groupRequests.length >= 10) {
        confidence = "HIGH";
      } else if (groupRequests.length >= 5) {
        confidence = "MEDIUM";
      }

      return {
        bloodGroup,
        currentStock,
        predictedDemand,
        shortage,
        risk,
        confidence,
        recentRequests: groupRequests.length,
      };
    });

    // -----------------------------------------
    // HIGH / CRITICAL BLOOD GROUPS
    // -----------------------------------------

    const highRiskGroups = predictions
      .filter(
        (item) =>
          item.risk === "HIGH" ||
          item.risk === "CRITICAL"
      )
      .map((item) => item.bloodGroup);

    const insufficientDataGroups = predictions
      .filter((item) => item.risk === "INSUFFICIENT_DATA")
      .map((item) => item.bloodGroup);

    // -----------------------------------------
    // INSIGHT
    // -----------------------------------------

    let insight;

    if (highRiskGroups.length > 0) {
      insight = `Blood groups ${highRiskGroups.join(
        ", "
      )} may face shortages based on recent demand and current inventory.`;
    } else if (insufficientDataGroups.length === 8) {
      insight =
        "There is not enough historical request data to generate reliable demand predictions. More blood request records are needed.";
    } else if (insufficientDataGroups.length > 0) {
      insight =
        "Some blood groups do not have enough historical request data for a reliable prediction.";
    } else {
      insight =
        "Current blood inventory appears sufficient based on recent demand.";
    }

    res.status(200).json({
      success: true,
      predictions,
      insight,
    });
  } catch (error) {
    console.error("Blood Prediction Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate blood prediction",
    });
  }
};
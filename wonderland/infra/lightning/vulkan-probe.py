#!/usr/bin/env python3
"""Does a Vulkan instance actually come up, and does it see an NVIDIA GPU?

THE QUESTION THIS EXISTS TO ANSWER. `nvidia-smi` reported a healthy L4 while
the packaged client died in RHIInit with VK_ERROR_INCOMPATIBLE_DRIVER (-9) from
vpCreateInstance. Those are different subsystems: nvidia-smi talks to the kernel
driver through /dev/nvidiactl, Vulkan needs a loader, an ICD manifest, and the
userspace driver library the manifest points at. Any of the three can be absent
on a machine whose nvidia-smi is perfect, so treating nvidia-smi as proof of
Vulkan is exactly the mistake that cost this GPU session.

Uses ctypes against libvulkan.so.1 rather than a compiled probe: the Studio has
no Vulkan headers and no reason to gain a build step for one question. Prints
JSON on stdout. Exit 0 means an NVIDIA physical device was enumerated; anything
else is a reason, never a guess.
"""
import ctypes, json, os, sys

VK_STRUCTURE_TYPE_APPLICATION_INFO = 0
VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO = 1
VENDOR_NVIDIA = 0x10DE

# The VkResult values that actually turn up here. Anything else is printed raw
# rather than translated into a confident wrong word.
VK_RESULTS = {
    0: "VK_SUCCESS",
    -1: "VK_ERROR_OUT_OF_HOST_MEMORY",
    -2: "VK_ERROR_OUT_OF_DEVICE_MEMORY",
    -3: "VK_ERROR_INITIALIZATION_FAILED",
    -6: "VK_ERROR_LAYER_NOT_PRESENT",
    -7: "VK_ERROR_EXTENSION_NOT_PRESENT",
    -8: "VK_ERROR_FEATURE_NOT_PRESENT",
    -9: "VK_ERROR_INCOMPATIBLE_DRIVER",
    -10: "VK_ERROR_TOO_MANY_OBJECTS",
}


class VkApplicationInfo(ctypes.Structure):
    _fields_ = [
        ("sType", ctypes.c_uint32),
        ("pNext", ctypes.c_void_p),
        ("pApplicationName", ctypes.c_char_p),
        ("applicationVersion", ctypes.c_uint32),
        ("pEngineName", ctypes.c_char_p),
        ("engineVersion", ctypes.c_uint32),
        ("apiVersion", ctypes.c_uint32),
    ]


class VkInstanceCreateInfo(ctypes.Structure):
    _fields_ = [
        ("sType", ctypes.c_uint32),
        ("pNext", ctypes.c_void_p),
        ("flags", ctypes.c_uint32),
        ("pApplicationInfo", ctypes.POINTER(VkApplicationInfo)),
        ("enabledLayerCount", ctypes.c_uint32),
        ("ppEnabledLayerNames", ctypes.c_void_p),
        ("enabledExtensionCount", ctypes.c_uint32),
        ("ppEnabledExtensionNames", ctypes.c_void_p),
    ]


def result_name(code):
    return VK_RESULTS.get(code, "VkResult=%d" % code)


def probe(api_version):
    """One attempt at a given API version. Returns (ok, detail_dict)."""
    out = {"apiVersion": "%d.%d" % (api_version >> 22, (api_version >> 12) & 0x3FF)}
    try:
        lib = ctypes.CDLL("libvulkan.so.1")
    except OSError as e:
        out["stage"] = "load_loader"
        out["error"] = str(e)
        return False, out
    out["loaderLoaded"] = True

    app = VkApplicationInfo(
        sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,
        pNext=None,
        pApplicationName=b"wonderland-vulkan-probe",
        applicationVersion=1,
        pEngineName=b"wonderland",
        engineVersion=1,
        apiVersion=api_version,
    )
    ci = VkInstanceCreateInfo(
        sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
        pNext=None,
        flags=0,
        pApplicationInfo=ctypes.pointer(app),
        enabledLayerCount=0,
        ppEnabledLayerNames=None,
        enabledExtensionCount=0,
        ppEnabledExtensionNames=None,
    )
    instance = ctypes.c_void_p()
    rc = lib.vkCreateInstance(ctypes.byref(ci), None, ctypes.byref(instance))
    out["vkCreateInstance"] = result_name(rc)
    if rc != 0:
        out["stage"] = "create_instance"
        return False, out

    count = ctypes.c_uint32(0)
    rc = lib.vkEnumeratePhysicalDevices(instance, ctypes.byref(count), None)
    out["vkEnumeratePhysicalDevices"] = result_name(rc)
    out["physicalDeviceCount"] = int(count.value)
    if rc != 0 or count.value == 0:
        out["stage"] = "enumerate"
        lib.vkDestroyInstance(instance, None)
        return False, out

    devices = (ctypes.c_void_p * count.value)()
    lib.vkEnumeratePhysicalDevices(instance, ctypes.byref(count), devices)
    found = []
    for d in devices[: count.value]:
        # VkPhysicalDeviceProperties: apiVersion, driverVersion, vendorID,
        # deviceID, deviceType (5 x uint32), then deviceName[256]. The rest is
        # limits and sparse properties and is not read.
        buf = ctypes.create_string_buffer(2048)
        lib.vkGetPhysicalDeviceProperties(ctypes.c_void_p(d), buf)
        vendor, device = ctypes.cast(
            buf, ctypes.POINTER(ctypes.c_uint32)
        )[2], ctypes.cast(buf, ctypes.POINTER(ctypes.c_uint32))[3]
        name = ctypes.string_at(ctypes.addressof(buf) + 20, 256).split(b"\0")[0]
        found.append(
            {
                "name": name.decode("utf8", "replace"),
                "vendorID": "0x%04X" % vendor,
                "deviceID": "0x%04X" % device,
                "isNvidia": vendor == VENDOR_NVIDIA,
            }
        )
    lib.vkDestroyInstance(instance, None)
    out["devices"] = found
    out["stage"] = "enumerate"
    return any(d["isNvidia"] for d in found), out


def main():
    report = {
        "VK_ICD_FILENAMES": os.environ.get("VK_ICD_FILENAMES", ""),
        "VK_DRIVER_FILES": os.environ.get("VK_DRIVER_FILES", ""),
        "LD_LIBRARY_PATH": os.environ.get("LD_LIBRARY_PATH", ""),
        "attempts": [],
    }
    ok = False
    # UE's VP_UE_Vulkan_SM5 profile asks for 1.3; 1.1 is tried second so a
    # loader that merely refuses the newer API is distinguishable from one with
    # no usable driver at all. That distinction changes what the founder does.
    for api in ((1 << 22) | (3 << 12), (1 << 22) | (1 << 12)):
        good, detail = probe(api)
        report["attempts"].append(detail)
        if good:
            ok = True
            break
    report["nvidiaDeviceEnumerated"] = ok
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

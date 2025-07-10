#!/usr/bin/env python3

import sys
import os
from PIL import Image, ImageChops
import numpy as np

def detect_background_color(img, sample_size=50):
    """
    Detektuje dominantnu boju pozadine uzimajući sample sa ivica slike
    """
    width, height = img.size
    
    # Uzmi piksele sa ivica slike
    edge_pixels = []
    
    # Top edge
    for x in range(0, width, max(1, width//sample_size)):
        edge_pixels.append(img.getpixel((x, 0)))
    
    # Bottom edge  
    for x in range(0, width, max(1, width//sample_size)):
        edge_pixels.append(img.getpixel((x, height-1)))
    
    # Left edge
    for y in range(0, height, max(1, height//sample_size)):
        edge_pixels.append(img.getpixel((0, y)))
    
    # Right edge
    for y in range(0, height, max(1, height//sample_size)):
        edge_pixels.append(img.getpixel((width-1, y)))
    
    # Pronađi najčešću boju
    from collections import Counter
    
    if img.mode == 'RGBA':
        # Za RGBA, ignoriši alpha u poređenju
        simplified_pixels = [(r, g, b) for r, g, b, a in edge_pixels]
    else:
        simplified_pixels = edge_pixels
    
    most_common = Counter(simplified_pixels).most_common(1)
    
    if most_common:
        bg_color = most_common[0][0]
        print(f"Detected background color: {bg_color}")
        return bg_color
    
    return None

def is_similar_color(color1, color2, tolerance=30):
    """
    Proverava da li su dve boje slične u okviru tolerance
    """
    if len(color1) != len(color2):
        return False
    
    for c1, c2 in zip(color1, color2):
        if abs(c1 - c2) > tolerance:
            return False
    return True

def auto_crop_smart(image_path, output_path):
    """
    Tight crop sa minimalnim padding-om:
    - Samo 5px padding na svim stranama
    - Cropuje skoro do objekta
    - Radi sa transparent i belim pozadinama
    """
    try:
        print(f"Processing image: {image_path}")
        
        # Otvori sliku
        img = Image.open(image_path)
        original_mode = img.mode
        
        # Konvertuj u RGBA za lakše rukovanje
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
            print(f"Converted from {original_mode} to RGBA mode")
        
        print(f"Original size: {img.size}")
        width, height = img.size
        
        # Prvo pokušaj alpha-based crop za transparent slike
        alpha = img.split()[-1]  # Alpha kanal
        bbox_alpha = alpha.getbbox()
        
        # Ako alpha crop daje rezultate, koristi ga
        if bbox_alpha and (bbox_alpha[2] - bbox_alpha[0] < width or bbox_alpha[3] - bbox_alpha[1] < height):
            print(f"Using alpha-based crop: {bbox_alpha}")
            
            # Minimal padding: samo 5px na svim stranama
            padded_bbox = (
                max(0, bbox_alpha[0] - 5),    # levo - 5px
                max(0, bbox_alpha[1] - 5),    # gore - 5px
                min(width, bbox_alpha[2] + 5),     # desno + 5px
                min(height, bbox_alpha[3] + 5)     # dole + 5px
            )
            
            cropped = img.crop(padded_bbox)
            print(f"Alpha cropped with minimal padding (5px): {padded_bbox}")
            print(f"Final size: {cropped.size}")
            
        else:
            print("Alpha crop not effective, trying color-based crop")
            
            # Detektuj boju pozadine
            bg_color = detect_background_color(img)
            
            if bg_color is None:
                print("Could not detect background color, using original image")
                cropped = img
            else:
                # Kreiraj masku na osnovu sličnosti sa background bojom
                # Povećana tolerancija za bolje hvatanje belih/svetlih pozadina
                tolerance = 50
                if all(c > 200 for c in bg_color[:3]):  # Ako je svetla pozadina
                    tolerance = 70
                    print(f"Light background detected, increased tolerance to {tolerance}")
                
                mask = Image.new('L', (width, height), 0)
                mask_data = []
                
                for y in range(height):
                    for x in range(width):
                        pixel = img.getpixel((x, y))
                        
                        # Poredi samo RGB delove
                        pixel_rgb = pixel[:3] if len(pixel) >= 3 else pixel
                        
                        # Ako piksel nije sličan pozadini, dodaj ga u masku
                        if not is_similar_color(pixel_rgb, bg_color, tolerance=tolerance):
                            mask_data.append(255)  # Čuva piksel
                        else:
                            mask_data.append(0)    # Uklanja piksel
                
                mask.putdata(mask_data)
                
                # Pronađi bbox na osnovu maske
                bbox_color = mask.getbbox()
                
                if bbox_color:
                    print(f"Color-based crop box: {bbox_color}")
                    
                    # Minimal padding: samo 5px na svim stranama
                    padded_bbox = (
                        max(0, bbox_color[0] - 5),     # levo - 5px
                        max(0, bbox_color[1] - 5),     # gore - 5px
                        min(width, bbox_color[2] + 5),      # desno + 5px
                        min(height, bbox_color[3] + 5)      # dole + 5px
                    )
                    
                    cropped = img.crop(padded_bbox)
                    print(f"Color cropped with minimal padding (5px): {padded_bbox}")
                    print(f"Final size: {cropped.size}")
                else:
                    print("No significant content found, using original")
                    cropped = img
        
        # Sačuvaj cropovanu sliku bez dodatnog centriranja
        # Zadrži originalni format ako je moguće
        if original_mode == 'RGB' and cropped.mode == 'RGBA':
            # Konvertuj nazad u RGB sa belom pozadinom
            background = Image.new('RGB', cropped.size, (255, 255, 255))
            background.paste(cropped, mask=cropped.split()[-1])
            cropped = background
            print("Converted back to RGB with white background")
        elif original_mode == 'P' and cropped.mode == 'RGBA':
            # Za palette mode, konvertuj u RGB
            background = Image.new('RGB', cropped.size, (255, 255, 255))
            background.paste(cropped, mask=cropped.split()[-1])
            cropped = background
            print("Converted to RGB from palette mode")
        
        # Sačuvaj u odgovarajućem formatu
        save_format = 'PNG' if original_mode in ['RGBA', 'LA', 'P'] else 'JPEG'
        if save_format == 'JPEG' and cropped.mode == 'RGBA':
            # JPEG ne podržava transparentnost
            background = Image.new('RGB', cropped.size, (255, 255, 255))
            background.paste(cropped, mask=cropped.split()[-1])
            cropped = background
        
        # Optimizacija kvaliteta
        save_kwargs = {}
        if save_format == 'JPEG':
            save_kwargs = {'quality': 95, 'optimize': True}
        elif save_format == 'PNG':
            save_kwargs = {'optimize': True}
        
        cropped.save(output_path, save_format, **save_kwargs)
        print(f"Saved cropped image to: {output_path} (format: {save_format})")
        
        return True
        
    except Exception as e:
        print(f"Error processing image: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python cropper.py <input_image> <output_image>")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    if not os.path.exists(input_path):
        print(f"Input file does not exist: {input_path}")
        sys.exit(1)
    
    # Kreiraj output direktorij ako ne postoji
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    success = auto_crop_smart(input_path, output_path)
    
    if success:
        print("Image processing completed successfully")
        sys.exit(0)
    else:
        print("Image processing failed")
        sys.exit(1)

if __name__ == "__main__":
    main()